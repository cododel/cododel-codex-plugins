import {
  mkdir,
  readFile,
  rename,
  unlink,
  lstat,
  realpath,
  readdir,
  open,
} from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import { check } from "../core/types";
export async function atomicWrite(path: string, content: string) {
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  const file = await open(tmp, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(tmp, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}
export async function readJson<T>(path: string): Promise<T> {
  check(
    Bun.file(path).size <= 16_000_000,
    "SIZE",
    "Файл состояния превышает 16 MB",
  );
  return JSON.parse(await readFile(path, "utf8"));
}
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  async idle() {
    await this.tail;
  }
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pending >= 128)
      return Promise.reject(new Error("Очередь хранилища переполнена"));
    this.pending++;
    const next = this.tail.then(fn).finally(() => {
      this.pending--;
    });
    this.tail = next.catch(() => {});
    return next;
  }
}
export async function safePath(
  root: string,
  child: string,
  allowMissing = false,
) {
  const path = resolve(root, child);
  check(
    path !== root &&
      !relative(root, path).startsWith("..") &&
      !relative(root, path).startsWith("/"),
    "PATH",
    "Путь вне хранилища",
  );
  let cursor = root;
  for (const part of relative(root, path).split("/")) {
    cursor = join(cursor, part);
    try {
      check(
        !(await lstat(cursor)).isSymbolicLink(),
        "SYMLINK",
        "Символические ссылки запрещены",
      );
    } catch (e) {
      if (allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT") break;
      throw e;
    }
  }
  return path;
}
export async function acquireStore(project: string) {
  const base = await realpath(project);
  const root = join(base, "blueprints");
  await safePath(base, "blueprints", true);
  await mkdir(root, { recursive: true });
  const lock = join(root, ".blueprint.lock");
  const token = crypto.randomUUID();
  try {
    const h = await open(lock, "wx", 0o600);
    await h.writeFile(JSON.stringify({ pid: process.pid, token }));
    await h.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error(
      `Хранилище уже заблокировано: ${lock}. Завершите владельца. После аварии проверьте PID и удалите только устаревшую блокировку.`,
    );
  }
  return {
    root,
    release: async () => {
      const owner = await readJson<{ token: string }>(lock).catch(() => null);
      if (owner?.token === token) await unlink(lock);
    },
  };
}
export async function readSources(dir: string) {
  const files: Record<string, string> = {};
  files["blueprint.mdx"] = await readFile(
    await safePath(dir, "blueprint.mdx"),
    "utf8",
  );
  async function walk(prefix: string) {
    let entries;
    try {
      entries = await readdir(await safePath(dir, prefix), {
        withFileTypes: true,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const rel = `${prefix}/${entry.name}`;
      await safePath(dir, rel);
      if (entry.isDirectory()) await walk(rel);
      else {
        check(Object.keys(files).length < 100, "SIZE", "Слишком много файлов");
        const f = Bun.file(join(dir, rel));
        check(f.size <= 1_000_000, "SIZE", "Файл слишком большой");
        files[rel] = await f.text();
      }
    }
  }
  await walk("widgets");
  await walk("assets");
  return files;
}
