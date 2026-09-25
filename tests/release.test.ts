import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  git,
  patch,
  prepare,
  pushRelease,
  tagExists,
  verifyRelease,
  versions,
} from "../scripts/release/git";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "blueprint-release-"));
  const cwd = join(root, "work"),
    remote = join(root, "origin.git");
  mkdirSync(cwd);
  git(root, "init", "--bare", remote);
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Release test");
  git(cwd, "config", "user.email", "test@example.invalid");
  mkdirSync(join(cwd, ".codex-plugin"));
  for (const f of ["package.json", ".codex-plugin/plugin.json"])
    writeFileSync(
      join(cwd, f),
      JSON.stringify({ name: "blueprint-plugin", version: "0.1.2" }, null, 2) +
        "\n",
    );
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "test: initial");
  git(cwd, "remote", "add", "origin", remote);
  git(cwd, "push", "origin", "main");
  return { root, cwd, remote, base: git(cwd, "rev-parse", "HEAD") };
}
test("release input rejects shell syntax, minor bumps and noncanonical versions", () => {
  for (const v of [
    "0.2.0",
    "v0.1.3",
    "0.1.03",
    "0.1.3\n",
    "0.1.3;touch x",
    "0.1.-1",
  ])
    expect(() => patch(v)).toThrow();
  expect(patch("0.1.3")).toBe(3);
});
test("prepare is local, changes only version files; atomic push publishes exact commit and tag", () => {
  const f = fixture();
  try {
    expect(() => prepare(f.cwd, "0.1.2", f.base)).toThrow("increase");
    const commit = prepare(f.cwd, "0.1.3", f.base);
    expect(versions(f.cwd)).toBe("0.1.3");
    expect(git(f.remote, "rev-parse", "main")).toBe(f.base);
    expect(tagExists(f.remote, "v0.1.3")).toBe(false);
    verifyRelease(f.cwd, "0.1.3");
    pushRelease(f.cwd, "0.1.3", "main", f.base);
    expect(git(f.remote, "rev-parse", "main")).toBe(commit);
    expect(git(f.remote, "rev-parse", "v0.1.3")).toBe(commit);
    git(f.cwd, "checkout", "--detach", "v0.1.3");
    verifyRelease(f.cwd, "0.1.3");
    expect(() => prepare(f.cwd, "0.1.3", commit)).toThrow();
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(commit);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("branch advance aborts publication without creating remote tag", () => {
  const f = fixture();
  try {
    prepare(f.cwd, "0.1.3", f.base);
    const other = join(f.root, "other");
    git(f.root, "clone", "--branch", "main", f.remote, other);
    git(other, "config", "user.name", "Test");
    git(other, "config", "user.email", "test@example.invalid");
    writeFileSync(join(other, "work.txt"), "concurrent change");
    git(other, "add", "work.txt");
    git(other, "commit", "-m", "test: concurrent");
    git(other, "push", "origin", "main");
    expect(() => pushRelease(f.cwd, "0.1.3", "main", f.base)).toThrow(
      "Remote branch changed",
    );
    expect(tagExists(f.remote, "v0.1.3")).toBe(false);
    expect(git(f.remote, "rev-parse", "main")).toBe(
      git(other, "rev-parse", "HEAD"),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("dirty tree and manifest drift fail before version mutation", () => {
  const f = fixture();
  try {
    const original = readFileSync(join(f.cwd, "package.json"), "utf8");
    writeFileSync(join(f.cwd, "work.txt"), "operator work");
    expect(() => prepare(f.cwd, "0.1.3", f.base)).toThrow("clean");
    expect(readFileSync(join(f.cwd, "package.json"), "utf8")).toBe(original);
    writeFileSync(
      join(f.cwd, ".codex-plugin/plugin.json"),
      JSON.stringify({ version: "0.1.4" }),
    );
    expect(() => versions(f.cwd)).toThrow("drift");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("atomic push leaves branch untouched if server rejects the tag", () => {
  const f = fixture();
  try {
    prepare(f.cwd, "0.1.3", f.base);
    const hook = join(f.remote, "hooks/update");
    writeFileSync(
      hook,
      '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1;; esac\nexit 0\n',
    );
    chmodSync(hook, 0o755);
    expect(() => pushRelease(f.cwd, "0.1.3", "main", f.base)).toThrow();
    expect(git(f.remote, "rev-parse", "main")).toBe(f.base);
    expect(tagExists(f.remote, "v0.1.3")).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
