import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registryFile, type LocalOptions } from '../../cubbies/local/config.js';
import { jsonFile, uuid } from '../../cubbies/local/io.js';
import { pinOf, updatePins } from '../../cubbies/local/devices.js';
import { ownerPublicKey } from '../../cubbies/wire.js';
export interface MacConfig { home: string; projectsFile: string; state: string; computerId: string; ownerKey: string; replaceOwnerKey?: boolean }
export function configureMac(options: LocalOptions, home = os.homedir()): MacConfig {
  if (Object.keys(options).some(k => !['ownerKey', 'replaceOwnerKey'].includes(k))) throw Error('--hq takes no project, floor or lead options');
  if (!options.ownerKey) throw Error('--hq requires --owner-key from HQ setup');
  ownerPublicKey(options.ownerKey);
  const base = path.join(home, '.agent-office/hq'), file = path.join(base, 'computer.json');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  if (!existsSync(file)) {
    try { writeFileSync(file, JSON.stringify({ id: randomUUID() }), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  const computerId = jsonFile(file).id;
  if (!uuid(computerId)) throw Error('Invalid HQ computer identity');
  const state = path.join(base, computerId);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  return { home, projectsFile: registryFile(home), state, computerId, ownerKey: options.ownerKey, replaceOwnerKey: options.replaceOwnerKey };
}
/** Called under the Mac lock. Never accepts trust supplied by the relay. */
export function pinMac(config: MacConfig) {
  updatePins(config.state, 'hq', pins => {
    if (pins?.some(p => p.key === config.ownerKey)) return pins;
    if (pins && !config.replaceOwnerKey) throw Error('Different --owner-key: use --replace-owner-key locally only to authorize this device');
    return [pinOf(config.ownerKey, 'First device', Date.now())];
  });
}
