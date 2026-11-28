import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * What the owner calls this computer: on a Mac its Sharing name without the owner's name in front
 * ("Jonathan’s Mac mini" is "Mac mini", so the cubby says "Runs on your Mac mini"), else its hostname.
 */
export function friendlyName(): string {
  if (process.platform === 'darwin') {
    try {
      const name = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim();
      const plain = name.replace(/^.{1,40}?['’]s\s+/u, '').trim();
      if (plain) return plain;
    } catch { /* fall back to the hostname */ }
  }
  return os.hostname().replace(/\.(local|localdomain)$/i, '');
}
