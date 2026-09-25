---
name: blueprint
description: Create and iteratively review interactive MDX blueprints with questions, custom visualizations and anchored annotations. Use when the user asks to plan in Blueprint or review an existing blueprint.
---

# Blueprint

Use an adaptive planning conversation: inspect the project, surface consequential alternatives, and keep confirmed decisions distinct from proposals. Do not impose fixed phases. Never treat a timeout, default widget value, unresolved comment or unanswered question as consent.

1. Call `open_blueprint` with a short lowercase slug and title. Open the returned local URL in Codex's browser panel using `open_in_codex` when available; otherwise give the user the link. It contains a local access token: never publish it or put it in a repository.
2. Call `read_blueprint` to read the current revision, widget state and discussions. Drafts belong to the operator and are not actionable. Initial widget values are not answers: inspect `touched` and `confirmed`. Never replace operator answers with your proposals.
3. Use `read_changes` with a stable reader slug for this task. If resuming, omit cursor to start after that reader's saved position. Page using the returned `cursor` until `hasMore` is false. Read the current blueprint before acting: history explains what changed, the current state determines what is still relevant. Only after processing, call `acknowledge_changes` with that reader, processed cursor and prior `acknowledgedCursor`. Do not acknowledge changes you have not processed. A read, timeout or saved draft is not consent.
4. Author MDX and local files. Use stable widget IDs; increment Question `version` when meaning changes outside props. Call `describe_widget` only for needed components; for custom, read `references/custom.md` and use the SDK. Publish with both observed `expectedRevision` and `expectedEvent`; a conflict means reread and reconcile, never blindly retry with a new version. The user chooses when to switch revisions.
5. Use `add_annotation` to create an agent-authored open proposal or question with a stable UUID. Use `update_annotation` to reply (optionally link a revision), edit only your own original text, or change work status. Each operation needs a fresh UUID, reused on retries, and the last read annotation `expectedVersion`. Preserve original comments, anchors and history; do not edit metadata or annotations files directly.
6. Lifecycle: operator saves `draft`, opens it as `open`; agent moves `open` → `in_progress` or `needs_input`, then `ready_for_review`. When responding to a clarification or reworking a proposal, return to `in_progress`. Operator alone resolves, reopens, archives and restores. Archive is separate from status. Explain the proposed resolution in a reply with the relevant revision before marking `ready_for_review`. Never interpret status as implementation authority. An annotation on a different revision keeps its original quote and needs anchor review; do not silently reanchor or close it because a block disappeared.
7. No Send button or submission is required. Widget answers and saved annotations are already durable. A chat message conveys the operator's intent to continue. `wait_for_changes` is optional bounded waiting during an active turn, not an automatic wake-up mechanism. Do not loop indefinitely or claim that a background MCP process can start a new turn.
8. Approval fixes a specific revision and state. It never authorizes implementation, deployment or Git changes. Ask for a separate implementation instruction if needed.

## First document

```mdx
# Proposed architecture

Explain motivation, constraints and evidence before the choice.

<Question id="storage" title="Where should state live?" options={["Project", "Application"]} />

<Comparison id="tradeoffs" columns={["Option", "Benefit", "Cost"]} rows={[["Project", "Portable", "Local only"]]} />
```

Use the workspace selected for the MCP process. If it points at the plugin installation rather than the user's project, correct the server's working directory before creating documents. A second process cannot write the same store concurrently; stop its owner instead of deleting live locks.
