import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const versionFiles = ["package.json", ".codex-plugin/plugin.json"];
export function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function patch(version: string) {
  if (
    !/^0\.1\.(0|[1-9]\d*)$/.test(version) ||
    !Number.isSafeInteger(Number(version.split(".")[2]))
  )
    throw new Error("Version must be 0.1.N");
  return Number(version.split(".")[2]);
}
export function versions(cwd: string) {
  const files = versionFiles.map((f) =>
    JSON.parse(readFileSync(join(cwd, f), "utf8")),
  );
  if (files[0].version !== files[1].version)
    throw new Error("Manifest version drift");
  patch(files[0].version);
  return files[0].version as string;
}
export function tagExists(cwd: string, tag: string) {
  return git(cwd, "tag", "--list", tag) === tag;
}
export function verifyRelease(cwd: string, version: string) {
  if (versions(cwd) !== version) throw new Error("Tag version mismatch");
  if (
    git(cwd, "log", "-1", "--format=%s") !==
    `chore(release): prepare v${version}`
  )
    throw new Error("Tag is not a release commit");
  const changed = git(
    cwd,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "HEAD",
  )
    .split("\n")
    .sort();
  if (JSON.stringify(changed) !== JSON.stringify([...versionFiles].sort()))
    throw new Error("Release commit must change only version files");
  if (
    patch(version) <=
    patch(JSON.parse(git(cwd, "show", "HEAD^:package.json")).version)
  )
    throw new Error("Release must increase patch version");
}
export function prepare(cwd: string, version: string, base: string) {
  patch(version);
  if (git(cwd, "status", "--porcelain"))
    throw new Error("Working tree must be clean");
  if (git(cwd, "rev-parse", "HEAD") !== base)
    throw new Error("Checkout changed since validation");
  if (patch(version) <= patch(versions(cwd)))
    throw new Error("New release must increase patch version");
  if (tagExists(cwd, `v${version}`)) throw new Error("Tag already exists");
  for (const f of versionFiles) {
    const p = join(cwd, f),
      data = JSON.parse(readFileSync(p, "utf8"));
    data.version = version;
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  }
  git(cwd, "add", "--", ...versionFiles);
  git(cwd, "commit", "-m", `chore(release): prepare v${version}`);
  verifyRelease(cwd, version);
  return git(cwd, "rev-parse", "HEAD");
}
export function pushRelease(
  cwd: string,
  version: string,
  branch: string,
  base: string,
) {
  verifyRelease(cwd, version);
  if (git(cwd, "rev-parse", "HEAD^") !== base)
    throw new Error("Release parent changed");
  const ref = `refs/heads/${branch}`,
    tag = `v${version}`;
  git(cwd, "check-ref-format", ref);
  if (git(cwd, "ls-remote", "origin", ref).split(/\s/)[0] !== base)
    throw new Error("Remote branch changed; rerun release on its new HEAD");
  if (tagExists(cwd, tag)) throw new Error("Local tag already exists");
  git(cwd, "tag", tag);
  // Lease guards the checked source SHA; HEAD is verified as its direct child.
  git(
    cwd,
    "push",
    "--atomic",
    `--force-with-lease=${ref}:${base}`,
    "origin",
    `HEAD:${ref}`,
    `refs/tags/${tag}`,
  );
}
