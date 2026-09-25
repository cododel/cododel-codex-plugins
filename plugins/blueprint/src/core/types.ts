import type { AnnotationOperation } from "./annotations";
import { z } from "zod";
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValue),
    z.record(jsonValue),
  ]),
);
export const anchorSchema = z
  .object({
    block: z.string().max(160),
    quote: z.string().min(1).max(8000),
    prefix: z.string().max(160),
    suffix: z.string().max(160),
  })
  .strict();
export type Anchor = z.infer<typeof anchorSchema>;
export type Actor = "operator" | "agent";
export interface Annotation {
  id: string;
  revision: number;
  anchor: Anchor;
  text: string;
  status:
    | "draft"
    | "open"
    | "in_progress"
    | "needs_input"
    | "ready_for_review"
    | "resolved";
  author: Actor;
  version: number;
  archived: boolean;
  replies: Array<{
    id: string;
    actor: Actor;
    text: string;
    revision?: number;
    createdAt: string;
  }>;
  history: Array<{
    version: number;
    actor: Actor;
    at: string;
    kind: string;
    text?: string;
    status?: string;
    operation?: AnnotationOperation;
  }>;
  createdAt: string;
}
export interface WidgetState {
  value: Json;
  signature: string;
  confirmed: boolean;
  touched: boolean;
  active?: boolean;
}
export interface DocumentState {
  version: number;
  widgets: Record<string, WidgetState>;
}
export interface Metadata {
  schemaVersion: 1 | 2;
  readCursors?: Record<string, number>;
  historyStart?: number;
  name: string;
  title: string;
  revision: number;
  event: number;
  approved: null | { revision: number; stateVersion: number; at: string };
  states: Record<string, DocumentState>;
}
export interface Revision {
  revision: number;
  createdAt: string;
  files: Record<string, string>;
  code: string;
  digest: string;
}
export interface Snapshot {
  metadata: Metadata;
  annotations: Annotation[];
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function check(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
export const filesSchema = z
  .record(z.string().max(1_000_000))
  .refine(
    (v) =>
      Object.keys(v).length <= 100 && JSON.stringify(v).length <= 4_000_000,
    "Максимум 100 файлов и 4 MB",
  );
export function validateFiles(files: Record<string, string>) {
  filesSchema.parse(files);
  check(
    typeof files["blueprint.mdx"] === "string",
    "SOURCE",
    "Нужен blueprint.mdx",
  );
  for (const path of Object.keys(files))
    check(
      /^(blueprint\.mdx|(?:widgets|assets)\/[a-zA-Z0-9_./-]+)$/.test(path) &&
        !path.split("/").some((p) => p === ".." || p === "." || p === "") &&
        /\.(mdx|tsx|ts|jsx|js|json|svg|css)$/.test(path),
      "PATH",
      `Недопустимый исходный файл: ${path}`,
    );
}

export interface Change {
  cursor: number;
  actor: Actor | "system";
  kind: string;
  revision: number;
  at: string;
  annotation?: Annotation;
  annotationId?: string;
  widget?: { id: string; state: WidgetState };
}
export interface ChangePage {
  changes: Change[];
  cursor: number;
  latestCursor: number;
  hasMore: boolean;
  acknowledgedCursor: number;
}
