import type { AutonomyMode } from './providers/autonomy.js';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** The advertised ACP mode contract, independent of approval cards and the active prompt. */
export class KimiAutonomy {
  private available: string[] = [];
  private current?: string;
  private sequence = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private changed: (mode: AutonomyMode | undefined, source: 'ack' | 'observed') => void) {}
  adopt(value: unknown): void {
    const modes = record(value) && record(value.modes) ? value.modes : undefined;
    this.available = modes && Array.isArray(modes.availableModes) ? modes.availableModes.filter(record).map(m => String(m.id)) : [];
    this.observe(modes?.currentModeId);
  }
  update(value: unknown): void { if (record(value) && value.sessionUpdate === 'current_mode_update') this.observe(value.currentModeId); }
  private observe(id: unknown): void {
    if (typeof id !== 'string') return;
    this.current = id; this.sequence++;
    this.changed(this.available.includes(id) ? id === 'auto' ? 'autonomous' : id === 'default' ? 'supervised' : undefined : undefined, 'observed');
  }
  set(mode: AutonomyMode, request: (id: string) => Promise<unknown>, live: () => boolean): Promise<{ applied: boolean; detail?: string }> {
    const action = async () => {
      const id = mode === 'autonomous' ? 'auto' : 'default';
      if (!live()) return { applied: false, detail: 'The Kimi session is not ready. Saved for its next launch.' };
      if (!this.available.includes(id)) return { applied: false, detail: `Kimi did not advertise ${id} mode. The running session was kept.` };
      const before = this.sequence;
      try {
        const response = await request(id);
        if (!record(response) || !live()) return { applied: false, detail: 'Kimi did not confirm the mode change. The saved preference is pending.' };
        if (this.sequence !== before && this.current !== id) return { applied: false, detail: 'Kimi reported a different current mode. The saved preference is pending.' };
        this.current = id; this.changed(mode, 'ack'); return { applied: true };
      } catch { return { applied: false, detail: 'Kimi rejected or timed out changing mode. The running session was kept; retry when ready.' }; }
    };
    const result = this.tail.then(action, action); this.tail = result; return result;
  }
}
