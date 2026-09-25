import { useState } from "react";
import type { Annotation } from "../core/types";
import type { AnnotationOperation } from "../core/annotations";
const labels: Record<Annotation["status"], string> = {
  draft: "Draft",
  open: "Open",
  in_progress: "In progress",
  needs_input: "Needs your input",
  ready_for_review: "Ready for review",
  resolved: "Resolved",
};
export function Annotations({
  items,
  revision,
  onUpdate,
}: {
  items: Annotation[];
  revision?: number;
  onUpdate: (a: Annotation, op: AnnotationOperation) => Promise<void>;
}) {
  const [archived, setArchived] = useState(false);
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />{" "}
        Show archived
      </label>
      {items
        .filter((a) => archived || !a.archived)
        .map((a) => (
          <Discussion
            key={a.id}
            a={a}
            revision={revision}
            onUpdate={onUpdate}
          />
        ))}
    </>
  );
}
function Discussion({
  a,
  revision,
  onUpdate,
}: {
  a: Annotation;
  revision?: number;
  onUpdate: (a: Annotation, op: AnnotationOperation) => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const [edit, setEdit] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(op: AnnotationOperation) {
    setBusy(true);
    setError("");
    try {
      await onUpdate(a, op);
      if (op.kind === "reply") setReply("");
      if (op.kind === "edit") setEdit(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const status = (next: Annotation["status"]) =>
    void act({ id: crypto.randomUUID(), kind: "status", status: next });
  return (
    <article className="comment" aria-label={`Annotation ${a.id}`}>
      <span className="small">
        {labels[a.status]} · {a.author} · revision {a.revision}
        {a.archived ? " · Archived" : ""}
        {a.revision !== revision ? " · Anchor needs review" : ""}
      </span>
      <blockquote>{a.anchor.quote}</blockquote>
      {edit !== undefined ? (
        <>
          <textarea
            aria-label="Edit annotation"
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
          />
          <button
            disabled={busy || !edit.trim()}
            onClick={() =>
              void act({ id: crypto.randomUUID(), kind: "edit", text: edit })
            }
          >
            Save edit
          </button>
          <button onClick={() => setEdit(undefined)}>Cancel</button>
        </>
      ) : (
        <p>{a.text}</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!a.archived && (
        <>
          {a.author === "operator" && (
            <button disabled={busy} onClick={() => setEdit(a.text)}>
              Edit
            </button>
          )}
          {a.status === "draft" ? (
            <button disabled={busy} onClick={() => status("open")}>
              Open for review
            </button>
          ) : (
            <>
              {a.replies.map((r) => (
                <div key={r.id}>
                  <span className="small">
                    {r.actor}
                    {r.revision ? ` · revision ${r.revision}` : ""}
                  </span>
                  <p>{r.text}</p>
                </div>
              ))}
              <textarea
                aria-label="Reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Add a reply or clarification"
              />
              <button
                disabled={busy || !reply.trim()}
                onClick={() =>
                  void act({
                    id: crypto.randomUUID(),
                    kind: "reply",
                    text: reply,
                  })
                }
              >
                Add reply
              </button>
              {a.status !== "open" && (
                <button disabled={busy} onClick={() => status("open")}>
                  {a.status === "resolved" ? "Reopen" : "Return to open"}
                </button>
              )}
              {a.status !== "resolved" && (
                <button disabled={busy} onClick={() => status("resolved")}>
                  {a.status === "ready_for_review"
                    ? "Accept resolution"
                    : "Resolve"}
                </button>
              )}
            </>
          )}
        </>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void act({
            id: crypto.randomUUID(),
            kind: "archive",
            archived: !a.archived,
          })
        }
      >
        {a.archived ? "Restore" : "Archive"}
      </button>
      <details>
        <summary>History ({a.history.length})</summary>
        {a.history.map((h) => (
          <div key={h.version} className="small">
            <p>
              {h.actor} · {h.kind} · {h.at}
            </p>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {h.text ?? (h.operation && JSON.stringify(h.operation, null, 2))}
            </pre>
          </div>
        ))}
      </details>
    </article>
  );
}
