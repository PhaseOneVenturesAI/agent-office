import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registryFile } from '../../cubbies/local/config.js';
import { jsonFile, uuid } from '../../cubbies/local/io.js';
export interface MacConfig { home: string; projectsFile: string; state: string; computerId: string }
export function configureMac(home = os.homedir()): MacConfig {
  const base = path.join(home, '.agent-office/link'), file = path.join(base, 'computer.json');
  mkdirSync(base, { recursive: true, mode: 0o700 }); chmodSync(base, 0o700);
  if (!existsSync(file)) {
    try { writeFileSync(file, JSON.stringify({ id: randomUUID() }), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  const computerId = jsonFile(file).id;
  if (!uuid(computerId)) throw Error('Invalid Mac link identity');
  chmodSync(file, 0o600);
  const state = path.join(base, computerId);
  mkdirSync(state, { recursive: true, mode: 0o700 }); chmodSync(state, 0o700);
  return { home, projectsFile: registryFile(home), state, computerId };
}
