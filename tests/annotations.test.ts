import { test, expect } from "bun:test";
import { createAnnotation, applyAnnotation } from "../src/core/annotations";
const anchor = { block: "text-0", quote: "Plan", prefix: "", suffix: "" };
const make = () =>
  createAnnotation("a", 1, anchor, "Please clarify", "operator", "draft");
test("draft -> open -> agent work -> operator acceptance; archive is separate", () => {
  let a = make();
  a = applyAnnotation(a, "operator", 1, {
    id: "1",
    kind: "status",
    status: "open",
  });
  a = applyAnnotation(a, "agent", 2, {
    id: "2",
    kind: "status",
    status: "in_progress",
  });
  a = applyAnnotation(a, "agent", 3, {
    id: "3",
    kind: "reply",
    text: "Addressed in revision 2",
    revision: 2,
  });
  a = applyAnnotation(a, "agent", 4, {
    id: "4",
    kind: "status",
    status: "ready_for_review",
  });
  expect(() =>
    applyAnnotation(a, "agent", 5, {
      id: "5",
      kind: "status",
      status: "resolved",
    }),
  ).toThrow();
  a = applyAnnotation(a, "operator", 5, {
    id: "6",
    kind: "status",
    status: "resolved",
  });
  a = applyAnnotation(a, "operator", 6, {
    id: "7",
    kind: "archive",
    archived: true,
  });
  expect(a.status).toBe("resolved");
  expect(a.archived).toBe(true);
  expect(a.history).toHaveLength(7);
  a = applyAnnotation(a, "operator", 7, {
    id: "8",
    kind: "archive",
    archived: false,
  });
  a = applyAnnotation(a, "operator", 8, {
    id: "9",
    kind: "status",
    status: "open",
  });
  expect(a.replies[0].actor).toBe("agent");
  expect(a.replies[0].revision).toBe(2);
});
test("ownership, version conflict, idempotent replay and original text history", () => {
  let a = make();
  expect(() =>
    applyAnnotation(a, "agent", 1, {
      id: "x",
      kind: "reply",
      text: "Premature",
    }),
  ).toThrow();
  a = applyAnnotation(a, "operator", 1, {
    id: "edit",
    kind: "edit",
    text: "Clarify scope",
  });
  expect(a.history[0].text).toBe("Please clarify");
  expect(
    applyAnnotation(a, "operator", 1, {
      id: "edit",
      kind: "edit",
      text: "Clarify scope",
    }),
  ).toEqual(a);
  expect(() =>
    applyAnnotation(a, "operator", 1, {
      id: "edit",
      kind: "edit",
      text: "Other",
    }),
  ).toThrow();
  expect(() =>
    applyAnnotation(a, "operator", 1, {
      id: "stale",
      kind: "status",
      status: "open",
    }),
  ).toThrow();
  expect(() =>
    applyAnnotation(a, "agent", 2, {
      id: "replace",
      kind: "edit",
      text: "My answer",
    }),
  ).toThrow();
  expect(() =>
    applyAnnotation(a, "agent", 2, {
      id: "archive",
      kind: "archive",
      archived: true,
    }),
  ).toThrow();
});
