import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanProjectCommand, projectFolder, STUDIO_ORG, validFolder, type ProjectCommand, type ProjectResult } from '../../shared/protocol/studio.js';
import type { MacConfig } from '../hq/local/config.js';
import { nativeEnv, canonical } from '../cubbies/local/io.js';
import { localDesign, regularDirectory } from '../cubbies/local/design.js';
import { documentTransaction, kickoffDocuments } from '../drafts/documents.js';
import { originRepo } from '../hq/local/origin.js';
import { githubRepo } from '../hq/projects.js';
import { projectRegistry, optionalRegistry, linkRegistryFile, saveProject, writeRequest, type LinkProject } from './project-registry.js';
import { startProjectLead } from './project-lead.js';
import { MAIN_LEAD_PROMPT, STUDIO_PROMPT } from './studio-prompt.js';
export type ProjectRun = (bin: 'git' | 'gh', args: string[], cwd: string) => Promise<string>;
export const runProject: ProjectRun = (bin, args, cwd) => new Promise((resolve, reject) => {
  execFile(bin, args, { cwd, env: { ...nativeEnv(), GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' }, shell: false, timeout: 120_000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' }, (error, stdout) => error ? reject(Error(`${bin} could not finish; check this project on your Mac`)) : resolve(stdout.trim()));
});
/** Serial local mutations. Replayed ids never re-run gh or start a second lead. */
export class LinkProjects {
  private busy = false;
  private results = new Map<string, ProjectResult>();
  private abort = new AbortController();
  constructor(private config: MacConfig, private send: (result: ProjectResult) => unknown, private run = runProject, private start = startProjectLead) {}
  close() { this.abort.abort(); }
  async receive(raw: unknown) {
    const frame = cleanProjectCommand(raw); if (!frame) return false;
    const old = this.results.get(frame.id); if (old) { this.send(old); return true; }
    if (this.busy) { this.send({ t: 'project.result', id: frame.id, ok: false, detail: 'Another project operation is running on your Mac' }); return true; }
    this.busy = true;
    let result: ProjectResult;
    try { const p = await this.perform(frame); result = { t: 'project.result', id: frame.id, ok: true, detail: frame.t === 'project.new' ? 'Your private Studio is ready' : 'Project ready; opening its floor', project: p.name, ...(p.url ? { repo: githubRepo(p.url) } : {}) }; }
    catch (e) { result = { t: 'project.result', id: frame.id, ok: false, detail: e instanceof Error && !('code' in e) ? e.message : 'Could not update project files on your Mac; check the folder locally' }; }
    finally { this.busy = false; }
    this.results.set(frame.id, result); if (this.results.size > 256) this.results.delete(this.results.keys().next().value!);
    this.send(result); return true;
  }
  private root() {
    const root = path.join(this.config.home, 'Documents/GitHub');
    mkdirSync(root, { recursive: true }); regularDirectory(root); return root;
  }
  private folder(folder: string) {
    if (!validFolder(folder)) throw Error('Use a folder name of letters, numbers, dots, underscores or hyphens');
    return path.join(this.root(), folder);
  }
  private async perform(f: ProjectCommand): Promise<LinkProject> {
    const registry = projectRegistry(this.config), entries = Object.entries(registry.projects) as [string, any][];
    if (f.t === 'project.new') {
      const dir = this.folder(projectFolder(f.name)!);
      if (entries.some(([name]) => name.toLowerCase() === f.name.toLowerCase())) throw Error('A project with that name is already registered');
      // Exclusive mkdir also refuses dangling symlinks and case-insensitive name collisions.
      try { mkdirSync(dir); } catch { throw Error('That folder already exists; use Add your project'); }
      await this.run('git', ['init', '-b', 'main'], dir);
      mkdirSync(path.join(dir, '.agent-office'), { mode: 0o700 });
      const p: LinkProject = { name: f.name, path: dir, localState: 'draft', office: 'draft', leadSessionId: randomUUID() };
      saveProject(this.config, p); writeRequest(this.config, 'new-project', f.id, p);
      await this.start(this.config, dir, p.leadSessionId!, STUDIO_PROMPT, this.abort.signal);
      return p;
    }
    if (f.t === 'project.open') {
      const raw = registry.projects[f.project];
      if (raw?.localState === 'present') throw Error('This project is already present on your Mac. Use Add your project to open its repository floor');
      if (!raw || raw.office === 'hidden' || raw.localState !== 'draft' || f.confirm !== f.project) throw Error('Type the exact draft project name to open its floor');
      const p: LinkProject = { ...raw, name: f.project };
      if (!projectFolder(p.name)) throw Error('This draft name cannot make a repository folder');
      if (path.dirname(p.path) !== this.root() || canonical(p.path) !== p.path) throw Error('Draft folder is not in your GitHub folder');
      regularDirectory(p.path); regularDirectory(path.join(p.path, '.git'));
      if (await this.run('git', ['remote'], p.path)) throw Error('This draft already has a remote; check it locally before opening');
      if (await this.run('git', ['diff', '--cached', '--name-only'], p.path)) throw Error('Commit or unstage existing changes locally before opening the floor');
      const local = localDesign(p.path), docs = kickoffDocuments(p.name, local.boards, hash => local.images.get(hash));
      documentTransaction(p.path, docs).write();
      await this.run('git', ['add', '--', ...Object.keys(docs)], p.path);
      await this.run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Open project floor'], p.path);
      const repo = `${STUDIO_ORG}/${projectFolder(p.name)!.toLowerCase()}`;
      // gh create refuses an existing repo; never substitute a push to an existing remote.
      await this.run('gh', ['repo', 'create', repo, '--private', '--source', '.', '--push'], p.path);
      p.localState = 'present'; p.url = `https://github.com/${repo}`; delete p.office;
      saveProject(this.config, p); writeRequest(this.config, 'kicked-off', f.id, p); return p;
    }
    const folder = f.folder ?? f.repo!.split('/')[1], dir = this.folder(folder);
    if (existsSync(dir)) {
      regularDirectory(dir);
      if (canonical(dir) !== dir) throw Error('Project folder must be directly under your GitHub folder');
      const origin = originRepo(dir);
      if (!origin || f.repo && origin.toLowerCase() !== f.repo.toLowerCase()) throw Error('Existing folder origin does not match that GitHub repository');
    } else {
      if (!f.repo) throw Error('That folder does not exist; enter owner/repo to clone it');
      if (lstatExists(dir)) throw Error('Project folder is not a regular directory');
      await this.run('gh', ['repo', 'clone', f.repo, dir], this.root());
      regularDirectory(dir);
    }
    const repo = originRepo(dir);
    if (!repo || f.repo && repo.toLowerCase() !== f.repo.toLowerCase()) throw Error('Could not verify the cloned GitHub origin');
    const existing = entries.find(([, p]) => canonical(p?.path) === canonical(dir));
    if (existing?.[1].office === 'hidden' || ['archived', 'remote-only'].includes(existing?.[1].localState)) throw Error('This project is hidden or archived in the harness registry');
    const registered = existing?.[1];
    // A pending harness registration must never start a second office-created lead.
    const own = Object.values(optionalRegistry(linkRegistryFile(this.config.home)).projects).find((p: any) => canonical(p?.path) === canonical(dir)) as LinkProject | undefined;
    const session = registered?.leadSessionId ?? registered?.leadThreadId ?? (!registered?.leadAppSession ? own?.leadSessionId : undefined);
    const hasLead = session || registered?.leadAppSession;
    const p: LinkProject = { name: existing?.[0] ?? folder.slice(0, 60), path: dir, url: `https://github.com/${repo}`, localState: 'present', ...(session ? { leadSessionId: session } : {}) };
    if (!hasLead) p.leadSessionId = randomUUID();
    saveProject(this.config, p); writeRequest(this.config, 'add-project', f.id, p);
    if (!hasLead) await this.start(this.config, dir, p.leadSessionId!, MAIN_LEAD_PROMPT, this.abort.signal);
    return p;
  }
}
function lstatExists(file: string) { try { lstatSync(file); return true; } catch { return false; } }
