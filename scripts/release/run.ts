import { publishDraft } from "./publication";
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  git,
  patch,
  versions,
  tagExists,
  verifyRelease,
  prepare,
  pushRelease,
} from "./git";
const cwd = process.cwd();
const version = process.env.RELEASE_VERSION ?? "";
patch(version);
const tag = `v${version}`;
const repo = process.env.GITHUB_REPOSITORY ?? "";
const branch = process.env.RELEASE_BRANCH ?? "";
if (
  !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
  !branch ||
  process.env.GITHUB_ACTIONS !== "true"
)
  throw new Error("Release commands run only in GitHub Actions");
git(cwd, "check-ref-format", `refs/heads/${branch}`);
if (
  git(cwd, "remote", "get-url", "origin").replace(/\.git$/, "") !== `https://github.com/${repo}`
)
  throw new Error("Unexpected origin repository");
function output(key: string, value: string) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GITHUB_OUTPUT");
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
function gh(...args: string[]) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
async function release() {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Release lookup failed: HTTP ${res.status}`);
  const data = await res.json();
  if (typeof data.draft !== "boolean" || typeof data.html_url !== "string")
    throw new Error("Invalid release response");
  return data as { draft: boolean; html_url: string };
}
const command = process.argv[2];
if (command === "inspect") {
  const existing = await release();
  const hasTag = tagExists(cwd, tag);
  if (existing && !hasTag)
    throw new Error("Release exists without fetched tag");
  if (hasTag) {
    git(cwd, "checkout", "--detach", tag);
    verifyRelease(cwd, version);
    git(cwd, "merge-base", "--is-ancestor", "HEAD", `origin/${branch}`);
    output("resume", "true");
  } else {
    if (patch(version) <= patch(versions(cwd)))
      throw new Error("Choose a higher 0.1.x version");
    output("resume", "false");
  }
  output("base", git(cwd, "rev-parse", "HEAD"));
  output("done", String(existing !== null && !existing.draft));
  if (existing && !existing.draft)
    console.log(`Already published: ${existing.html_url}`);
} else if (command === "prepare") {
  if (process.env.RELEASE_RESUME === "true") verifyRelease(cwd, version);
  else prepare(cwd, version, process.env.RELEASE_BASE ?? "");
} else if (command === "publish") {
  verifyRelease(cwd, version);
  if (git(cwd, "status", "--porcelain"))
    throw new Error("Build changed tracked files");
  const archive = "dist/blueprint-plugin-macos-arm64.zip";
  const checksum = await Bun.file(`${archive}.sha256`).text();
  const bytes = await Bun.file(archive).arrayBuffer();
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (checksum !== `${digest}  blueprint-plugin-macos-arm64.zip\n`)
    throw new Error("ZIP checksum mismatch");
  if (process.env.RELEASE_RESUME !== "true")
    pushRelease(cwd, version, branch, process.env.RELEASE_BASE ?? "");
  const remote = git(cwd, "ls-remote", "origin", `refs/tags/${tag}`).split(
    /\s/,
  )[0];
  if (remote !== git(cwd, "rev-parse", "HEAD"))
    throw new Error("Remote tag differs from built commit");
  const url = await publishDraft({
    lookup: release,
    createDraft: () => {
      gh(
        "release",
        "create",
        tag,
        "--repo",
        repo,
        "--verify-tag",
        "--draft",
        "--title",
        `Blueprint ${version}`,
        "--generate-notes",
      );
    },
    uploadAndVerify: async () => {
      gh(
        "release",
        "upload",
        tag,
        archive,
        `${archive}.sha256`,
        "--repo",
        repo,
        "--clobber",
      );
      gh(
        "release",
        "download",
        tag,
        "--repo",
        repo,
        "--pattern",
        "blueprint-plugin-macos-arm64.zip*",
        "--dir",
        ".tmp/release-download",
        "--clobber",
      );
      const uploaded = new Bun.CryptoHasher("sha256")
        .update(
          await Bun.file(
            ".tmp/release-download/blueprint-plugin-macos-arm64.zip",
          ).arrayBuffer(),
        )
        .digest("hex");
      if (
        uploaded !== digest ||
        (await Bun.file(
          ".tmp/release-download/blueprint-plugin-macos-arm64.zip.sha256",
        ).text()) !== checksum
      )
        throw new Error("Uploaded artifact checksum mismatch");
    },
    publish: () => {
      gh("release", "edit", tag, "--repo", repo, "--draft=false");
    },
  });
  console.log(url);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nPublished [Blueprint ${version}](${url}) from ${remote}.\n`,
    );
} else throw new Error("Expected inspect, prepare or publish");
