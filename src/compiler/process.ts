import { DomainError } from "../core/types";
export class Compiler {
  private children = new Set<ReturnType<typeof Bun.spawn>>();
  private closed = false;
  constructor(
    private command: string[],
    private timeout = 20_000,
  ) {}
  async compile(files: Record<string, string>): Promise<string> {
    if (this.closed) throw new DomainError("CLOSED", "Сборщик остановлен", 503);
    const child = Bun.spawn([...this.command, "--compile-worker"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "production" },
    });
    this.children.add(child);
    const timer = setTimeout(() => child.kill(9), this.timeout);
    child.stdin.write(JSON.stringify(files));
    child.stdin.end();
    try {
      const [output, err, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (!output)
        throw new DomainError(
          "COMPILE",
          status === 0
            ? "Сборщик не вернул результат"
            : `Сборка остановлена или превысила ${this.timeout} ms. ${err.slice(0, 2000)}`,
        );
      const result = JSON.parse(output);
      if (result.error) throw new DomainError("COMPILE", result.error);
      return result.code;
    } finally {
      clearTimeout(timer);
      this.children.delete(child);
    }
  }
  get active() {
    return this.children.size;
  }
  async close() {
    this.closed = true;
    for (const child of this.children) child.kill(9);
    await Promise.all([...this.children].map((p) => p.exited));
  }
}
