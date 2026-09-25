# Cododel Codex plugins

This repository develops and publishes Codex plugins. `main` contains source and CI. The `marketplace` branch contains tested installable packages and `.agents/plugins/marketplace.json`.

## Install

In Codex **Add plugin marketplace**, set Source to `git@github.com:cododel/cododel-codex-plugins.git`, Git ref to `marketplace`, and leave Sparse paths empty. The marketplace name remains `cododel`; Blueprint's plugin name remains `blueprint-plugin`.

Agents receiving a repository link and an installation request should follow [the agent installation and operator-reply guide](docs/agent-install.md).

Existing installs that used Git ref `main` need a one-time switch to `marketplace`. Refresh or reinstall the plugin using Codex's normal plugin interface, then test it in a new task. The original standalone Blueprint repository remains available as historical source; ongoing changes belong here.

## Develop

`plugins.json` lists plugin IDs, package names, directories, runners, commands and shared build inputs. Blueprint lives in `plugins/blueprint`. Its dependencies and lockfile are local to that directory. From the repository root:

```sh
bun scripts/ci.ts validate
bun test tests/ci.test.ts tests/release.test.ts
bun scripts/ci.ts check blueprint
```

On pull requests and pushes to `main`, CI checks only affected plugins. A shared input checks its consumers. When Git history cannot establish a comparison base, CI checks all plugins. Root documentation changes run only the registry and routing tests. Each plugin has its own version and release.

## Release

Use **Actions → Release plugin → Run workflow** on `main` with plugin ID and next version, e.g. `blueprint` and `0.1.3`. Ordinary commits do not change plugin versions. The workflow checks only the selected plugin, creates a version-only commit and `blueprint/v0.1.3`, builds a ZIP, verifies its extracted MCP server, and publishes **Blueprint 0.1.3** in GitHub Releases. It then downloads the same release archive and publishes a new `marketplace` snapshot. No second compilation occurs for the catalog. The release needs the repository's built-in `GITHUB_TOKEN` with `contents: write` and branch protection that permits this release commit.

The marketplace branch has `release-lock.json` with each installed package's version, source commit, release tag, platform, archive SHA-256 and file hashes. A single commit changes the catalog, lock and selected package. Snapshot tags such as `marketplace/r0001` identify complete catalog revisions. GitHub's repository-wide `Latest` release is not an update source for an individual plugin.

If a run fails after the plugin release but before the catalog update, start the workflow again with the same plugin and version. It verifies the already published asset and completes the catalog update without a new version or build. The old catalog stays available until a replacement is complete. If `main` advances during release preparation, rerun from its new tip; the workflow never overwrites another commit. Published tags/assets are immutable. Roll back a catalog by publishing a new snapshot with the selected older package after reviewing its compatibility; never move published tags.

Initial packages target macOS Apple Silicon. Ready-to-install binaries live in Git history on the `marketplace` branch, so its size grows with releases. The 0.1.2 package predates this pipeline; 0.1.3 is its first release through the monorepo.
