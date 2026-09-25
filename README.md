# Cododel marketplace

Connect Codex to `git@github.com:cododel/cododel-codex-plugins.git` with Git ref `marketplace`. Install `blueprint-plugin` from the Cododel marketplace. This branch contains release packages; source and CI are on `main`.

Snapshot 1 is described by `release-lock.json`. GitHub Releases provide per-plugin ZIP archives; Codex installs the folders listed in `.agents/plugins/marketplace.json`.

If you gave this marketplace link to an agent, ask it to follow the [Blueprint agent installation and operator-reply guide](https://github.com/cododel/cododel-codex-plugins/blob/main/docs/agent-install.md).
