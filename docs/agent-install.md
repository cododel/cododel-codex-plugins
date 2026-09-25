# Agent guide: install Blueprint in Codex

Use this guide when an operator gives you a link to this repository or the Cododel marketplace and asks you to install Blueprint, check its installation, or explain why it is unavailable. If the operator only asks a question, inspect state without changing their Codex configuration.

The repository has two roles: `main` contains source and CI; `marketplace` contains the installable package and `.agents/plugins/marketplace.json`. The marketplace name is `cododel`; the plugin selector is `blueprint-plugin@cododel`. The current package targets **macOS Apple Silicon**. It includes its own executable; the operator does not need Bun or Node.

## Install or recover

1. Check the local host and existing state. Confirm `uname -s` is `Darwin` and `uname -m` is `arm64`. Run `codex plugin marketplace list --json` and `codex plugin list --json`. If `cododel` already exists, inspect its configured Git ref; do not create a duplicate marketplace or replace an unrelated source. A listing in the Plugins Directory means the package is discoverable, **not** installed.
2. In Codex's **Add plugin marketplace** form, use Source `https://github.com/cododel/cododel-codex-plugins.git`, Git ref `marketplace`, and an empty **Sparse paths** field. Do not use `main` or the example sparse path `plugins/codex`. If the marketplace is already configured at `marketplace`, skip this step. If it points elsewhere, report the mismatch and change the existing source only within the operator's installation request; do not silently remove other plugins.
3. Install **Blueprint** from that marketplace. If the Desktop Install button is disabled but the operator asked you to install, use the supported local CLI from the same host:
   ```sh
   codex plugin marketplace add https://github.com/cododel/cododel-codex-plugins.git --ref marketplace --json
   codex plugin add blueprint-plugin@cododel --json
   ```
   Run the first command only when the marketplace is missing. If it already exists, verify its source and ref first. Do not edit `config.toml` blindly or use the release ZIP as a second installation path.
4. Verify `codex plugin list --json` reports `blueprint-plugin@cododel` with the expected version, `installed: true`, and `enabled: true`. Verify `codex mcp list` includes the `blueprint` server. Restart Codex Desktop after marketplace or installation changes, then start a **new task** and check whether the agent can actually call Blueprint's MCP tools. A CLI installation, an `enabled` MCP row, and a direct binary handshake do not prove Desktop made those tools available to the agent.
5. When the operator requests a test document, use a disposable project or an explicitly selected workspace. Confirm the MCP server's working directory before creating a blueprint. Check `open_blueprint`, `read_blueprint`, saved widget state, and a saved annotation. Do not publish the local access token from a blueprint URL.

If the install command fails, preserve the exact error and identify whether the failure was marketplace retrieval, package installation, MCP startup, or Desktop tool discovery. Do not claim the plugin is active based only on files in a cache directory. For current Codex marketplace behavior, see [OpenAI's plugin packaging and local marketplace documentation](https://developers.openai.com/plugins/build/plugins).

## Reply to the operator

Report the furthest stage actually verified. Use one of these patterns, replacing bracketed fields with observed values:

- **Fully usable:** “Blueprint [version] установлен из `cododel` (ветка `marketplace`). В новой задаче Codex доступны его MCP-инструменты; тестовый документ, ответ и аннотация прошли проверку.”
- **Installed, Desktop unverified:** “Blueprint [version] установлен и включён по данным Codex CLI; MCP-сервер зарегистрирован. В текущей задаче инструменты [не появились / ещё не проверены], поэтому работу через Desktop я пока не подтверждаю. Перезапустите Codex и откройте новую задачу.”
- **Blocked:** “Установка Blueprint остановилась на этапе [этап]: [точная ошибка]. [Что уже изменено или ничего не изменено]. Следующий шаг: [одно конкретное действие].”

Distinguish a direct MCP/executable smoke test from actual availability in a Codex task. Never say “installed” because a marketplace card is visible, or “working in Desktop” because a server is listed as enabled.
