import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DraftBoards, Launched } from '../../shared/protocol/drafts.js';
import type { FloorDef } from '../building.js';
import { cleanDraftBoards } from './boards.js';
import { documentTransaction, kickoffDocuments } from './documents.js';
import { createOrgRemote, GIT_FLAGS, type KickoffRemote, type KickoffRunner } from './remote.js';

/** One bounded transaction in the server-created draft checkout; never in the owner's project. */
export async function kickoffProject(def: FloorDef, raw: DraftBoards, remote: KickoffRemote,
  run: KickoffRunner, publish: (launched: Launched) => void): Promise<Launched> {
  const boards = cleanDraftBoards(raw), documents = kickoffDocuments(def.name, boards);
  const git = (args: string[]) => run('git', [...GIT_FLAGS, ...args], def.dir);
  let reason = 'Could not prepare the draft. Check its local files and try again.';
  let head: string | undefined, files: ReturnType<typeof documentTransaction> | undefined;
  let bare: string | undefined, changed = false, remoteStarted = false;
  try {
    files = documentTransaction(def.dir, documents);
    if (await git(['branch', '--show-current']) !== 'main' || await git(['status', '--porcelain']) || await git(['remote'])) {
      throw Error('Draft must be clean on main with no remotes');
    }
    head = await git(['rev-parse', 'HEAD']);
    changed = true;
    files.write();
    await git(['add', '--', ...Object.keys(documents)]);
    await git(['commit', '-m', 'Kick off project']);
    const slug = def.id.replace(/^draft-/, '');
    reason = 'Could not create or push the kickoff remote. The floor is still a draft.';
    let repo: string | undefined;
    if (remote.kind === 'local') {
      mkdirSync(remote.dir, { recursive: true });
      const target = path.join(remote.dir, `${slug}.git`);
      // Exclusive creation: never reuse, overwrite, or remove somebody else's repository.
      mkdirSync(target);
      bare = target;
      await git(['init', '--bare', '--initial-branch=main', target]);
      remoteStarted = true;
      await git(['remote', 'add', 'origin', target]);
      await git(['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', 'push', '-u', 'origin', 'main']);
    } else {
      remoteStarted = true;
      repo = await createOrgRemote(remote, slug, def.dir, run);
    }
    const launched: Launched = { name: def.name, at: Date.now(), ...(repo ? { repo } : {}),
      brand: boards.brand, screens: boards.screens.filter(s => s.status === 'approved').map(s => s.title) };
    reason = 'Could not save kickoff. The floor is still a draft.';
    publish(launched);
    return launched;
  } catch {
    try {
      if (changed) {
        if (remoteStarted && (await git(['remote'])).split('\n').includes('origin')) await git(['remote', 'remove', 'origin']);
        if (head) await git(['update-ref', 'refs/heads/main', head]);
        files!.restore();
      }
    } catch {
      reason = 'Kickoff stopped. The floor is still a draft; its local files need checking before retrying.';
    } finally {
      try { if (bare) rmSync(bare, { recursive: true, force: true }); }
      catch { reason = 'Kickoff stopped. The floor is still a draft; its local remote needs cleanup before retrying.'; }
    }
    throw Error(reason);
  }
}
