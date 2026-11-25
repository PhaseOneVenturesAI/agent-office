// The plan limits of every provider that can report them for one sign-in (the office's own, or
// one account's): a PlanLimitsReader per provider, merged into the one state the meter shows.
// A provider joins only when it can genuinely report numbers — its CLI is installed and someone
// is signed in — so the toggle never offers a provider that could only show nothing.

import { LIMITS_PROVIDERS, type LimitsByProvider, type LimitsProvider } from '../../shared/protocol.js';
import { codexSignedIn, defaultCodexHome, defaultKimiHome, kimiSignedIn } from '../signin-flows.js';
import { claudeLimits } from './claude.js';
import { codexLimits } from './codex.js';
import { kimiLimits } from './kimi.js';
import { PlanLimitsReader, type LimitsRead } from './reader.js';

export interface LimitsSources {
  /** The `claude` and `codex` binaries, or null when they aren't installed. */
  claude: string | null;
  codex: string | null;
  /** The environment each provider's read runs with: the office's own, or one account's sign-in. */
  envFor(kind: LimitsProvider): Record<string, string>;
  /** Whether anyone is in the office to see the numbers; polls are skipped when not. */
  wanted(): boolean;
  onChange(state: LimitsByProvider): void;
}

export class LimitsHub {
  private readers = new Map<LimitsProvider, PlanLimitsReader>();

  constructor(src: LimitsSources) {
    const tell = () => src.onChange(this.state);
    const add = (provider: LimitsProvider, read: LimitsRead) => this.readers.set(provider, new PlanLimitsReader(read, src.wanted, tell));
    const claudeEnv = src.envFor('claude');
    if (src.claude) add('claude', claudeLimits(src.claude, claudeEnv));
    const codexEnv = src.envFor('codex');
    if (src.codex && codexSignedIn(defaultCodexHome(codexEnv))) add('codex', codexLimits(src.codex, codexEnv));
    const kimiEnv = src.envFor('kimi');
    if (kimiEnv.KIMI_API_KEY || kimiSignedIn(defaultKimiHome(kimiEnv))) add('kimi', kimiLimits(kimiEnv));
  }

  /** Every provider's limits, in the toggle's order, including ones not read yet. */
  get state(): LimitsByProvider {
    const out: LimitsByProvider = {};
    for (const p of LIMITS_PROVIDERS) {
      const r = this.readers.get(p);
      if (r) out[p] = r.state;
    }
    return out;
  }

  /** Reads again now: one provider's, or every provider's. */
  refresh(provider?: LimitsProvider) {
    if (provider) this.readers.get(provider)?.refresh();
    else for (const r of this.readers.values()) r.refresh();
  }

  close() {
    for (const r of this.readers.values()) r.close();
  }
}
