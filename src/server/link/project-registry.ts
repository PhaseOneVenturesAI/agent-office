import { chmodSync, existsSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { MacConfig } from '../hq/local/config.js';
import { canonical, jsonFile } from '../cubbies/local/io.js';
export interface LinkProject { name: string; path: string; url?: string; localState: 'draft' | 'present'; leadSessionId?: string; office?: 'draft' }
export interface OfficeRequest { schema: 1; kind: 'new-project' | 'kicked-off' | 'add-project'; id: string; createdAt: string; project: string; folder: string; repoUrl: string | null; leadSessionId: string | null; source: 'office-link' }
export const linkRegistryFile = (home: string) => path.join(home, '.agent-office/link/projects.json');
export const requestsDir = (home: string) => path.join(home, 'Library/Application Support/AgentHarness/office-requests');
export function privateRecord(file: string, value: unknown) {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw Error('Unsafe record directory');
  chmodSync(dir, 0o700);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); renameSync(tmp, file); }
  finally { try { unlinkSync(tmp); } catch { /* renamed */ } }
}
export function optionalRegistry(file: string): any { return existsSync(file) ? jsonFile(file, 256 * 1024) : { projects: {} }; }
export function mergeRegistries(harness: any, link: any) {
  const primary = harness?.projects ?? {}, secondary = link?.projects ?? {};
  const entries = Object.entries(primary) as [string, any][];
  const projects = Object.fromEntries(Object.entries(secondary).filter(([name, p]: [string, any]) => !entries.some(([n, h]) => n.toLowerCase() === name.toLowerCase() || h?.path === p?.path || (canonical(h?.path) && canonical(h?.path) === canonical(p?.path)))));
  return { ...harness, projects: { ...projects, ...primary } };
}
export const projectRegistry = (config: MacConfig) => mergeRegistries(optionalRegistry(config.projectsFile), optionalRegistry(linkRegistryFile(config.home)));
export function saveProject(config: MacConfig, project: LinkProject) {
  const registry = optionalRegistry(linkRegistryFile(config.home));
  privateRecord(linkRegistryFile(config.home), { projects: { ...registry.projects, [project.name]: project } });
}
export function writeRequest(config: MacConfig, kind: OfficeRequest['kind'], id: string, p: LinkProject) {
  const request: OfficeRequest = { schema: 1, kind, id, createdAt: new Date().toISOString(), project: p.name, folder: path.basename(p.path), repoUrl: p.url ?? null, leadSessionId: p.leadSessionId ?? null, source: 'office-link' };
  privateRecord(path.join(requestsDir(config.home), `${id}.json`), request);
  return request;
}
