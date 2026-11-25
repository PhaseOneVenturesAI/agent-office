/** Bounded decoded resources, including cancellation of loads whose board has gone away. */
export class DraftImageCache<T extends { close(): void }> {
  private done = new Map<string, T | null>();
  private loading = new Map<string, AbortController>();
  constructor(private capacity = 24) {
    if (!Number.isInteger(capacity) || capacity < 1) throw Error('Invalid image cache capacity');
  }

  get(key: string, load: (signal: AbortSignal) => Promise<T | null>, changed: () => void): T | null | undefined {
    if (this.done.has(key)) {
      const value = this.done.get(key)!;
      this.done.delete(key);
      this.done.set(key, value);
      return value;
    }
    if (!this.loading.has(key)) {
      const controller = new AbortController();
      this.loading.set(key, controller);
      void load(controller.signal).catch(() => null).then(value => {
        if (this.loading.get(key) !== controller) { value?.close(); return; }
        this.loading.delete(key);
        this.done.set(key, value);
        while (this.done.size > this.capacity) this.drop(this.done.keys().next().value!);
        changed();
      });
    }
    return undefined;
  }

  retain(keys: ReadonlySet<string>): void {
    for (const key of this.done.keys()) if (!keys.has(key)) this.drop(key);
    for (const [key, controller] of this.loading) if (!keys.has(key)) {
      this.loading.delete(key);
      controller.abort();
    }
  }

  private drop(key: string): void {
    this.done.get(key)?.close();
    this.done.delete(key);
  }
}
