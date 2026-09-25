import { DomainError } from "../core/types";
export class Events {
  private listeners = new Set<() => void>();
  closed = false;
  subscribe(fn: () => void) {
    if (this.closed) throw new DomainError("CLOSED", "Сервер остановлен", 503);
    if (this.listeners.size >= 64)
      throw new DomainError("BUSY", "Слишком много подписок", 429);
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit() {
    for (const fn of [...this.listeners]) fn();
  }
  get size() {
    return this.listeners.size;
  }
  close() {
    this.closed = true;
    this.emit();
    this.listeners.clear();
  }
  async wait<T>(
    read: () => Promise<T[]>,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const deadline = Date.now() + Math.min(55_000, Math.max(0, timeout));
    while (true) {
      if (signal?.aborted)
        throw new DomainError("ABORTED", "Ожидание отменено");
      if (this.closed) return [];
      let resolve!: () => void;
      const wake = new Promise<void>((r) => (resolve = r));
      const unsubscribe = this.subscribe(resolve);
      const abort = () => resolve();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      try {
        const items = await read();
        if (items.length) return items;
        if (Date.now() >= deadline) return [];
        await wake;
      } finally {
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener("abort", abort);
      }
    }
  }
}
