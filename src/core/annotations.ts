import { z } from "zod";
import { check, type Anchor, type Annotation, type Actor } from "./types";
export const annotationStatus = z.enum([
  "draft",
  "open",
  "in_progress",
  "needs_input",
  "ready_for_review",
  "resolved",
]);
export const annotationOperation = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1).max(80),
      kind: z.literal("reply"),
      text: z.string().trim().min(1).max(16000),
      revision: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      kind: z.literal("edit"),
      text: z.string().trim().min(1).max(16000),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      kind: z.literal("status"),
      status: annotationStatus,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      kind: z.literal("archive"),
      archived: z.boolean(),
    })
    .strict(),
]);
export type AnnotationOperation = z.infer<typeof annotationOperation>;
export function createAnnotation(
  id: string,
  revision: number,
  anchor: Anchor,
  text: string,
  author: Actor,
  status: "draft" | "open",
): Annotation {
  check(
    author === "operator" || status === "open",
    "ROLE",
    "Agent annotations must be open",
  );
  return {
    id,
    revision,
    anchor,
    text,
    status,
    author,
    version: 1,
    archived: false,
    replies: [],
    history: [
      {
        version: 1,
        actor: author,
        at: new Date().toISOString(),
        kind: "create",
        text,
        status,
      },
    ],
    createdAt: new Date().toISOString(),
  };
}
export function applyAnnotation(
  original: Annotation,
  actor: Actor,
  expected: number,
  input: AnnotationOperation,
): Annotation {
  const op = annotationOperation.parse(input);
  const prior = original.history.find((h) => h.operation?.id === op.id);
  if (prior) {
    check(
      prior.actor === actor &&
        JSON.stringify(prior.operation) === JSON.stringify(op),
      "IDEMPOTENCY",
      "Operation ID already used",
    );
    return original;
  }
  check(
    original.version === expected,
    "CONFLICT",
    "Annotation changed; read it again",
    409,
  );
  check(
    actor === "operator" || original.status !== "draft",
    "ROLE",
    "Draft is not ready for agent work",
    403,
  );
  check(
    op.kind === "archive" || !original.archived,
    "ARCHIVED",
    "Restore annotation before changing it",
  );
  check(
    original.history.length < 500,
    "LIMIT",
    "Annotation history limit reached",
  );
  const a = structuredClone(original);
  if (op.kind === "edit") {
    check(
      actor === a.author,
      "ROLE",
      "Only the author can edit the original text",
      403,
    );
    a.text = op.text;
  }
  if (op.kind === "reply") {
    check(a.replies.length < 200, "LIMIT", "Reply limit reached");
    a.replies.push({
      id: op.id,
      actor,
      text: op.text,
      revision: op.revision,
      createdAt: new Date().toISOString(),
    });
  }
  if (op.kind === "archive") {
    check(
      actor === "operator",
      "ROLE",
      "Only operator can archive or restore",
      403,
    );
    a.archived = op.archived;
  }
  if (op.kind === "status") {
    const operator: Record<Annotation["status"], string[]> = {
      draft: ["open"],
      open: ["draft", "resolved"],
      in_progress: ["open", "resolved"],
      needs_input: ["open", "resolved"],
      ready_for_review: ["open", "resolved"],
      resolved: ["open"],
    };
    const agent: Record<Annotation["status"], string[]> = {
      draft: [],
      open: ["in_progress", "needs_input"],
      in_progress: ["needs_input", "ready_for_review"],
      needs_input: ["in_progress"],
      ready_for_review: ["in_progress"],
      resolved: [],
    };
    check(
      (actor === "operator" ? operator : agent)[a.status].includes(op.status),
      "TRANSITION",
      "Transition not allowed for this role",
      403,
    );
    check(
      op.status !== "draft" || a.author === "operator",
      "ROLE",
      "Cannot turn an agent annotation into an operator draft",
    );
    a.status = op.status;
  }
  a.version++;
  a.history.push({
    version: a.version,
    actor,
    at: new Date().toISOString(),
    kind: op.kind,
    operation: op,
  });
  return a;
}
