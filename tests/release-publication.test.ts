import { findRelease } from "../scripts/release/github";
import { test, expect } from "bun:test";
import {
  publishDraft,
  type ReleaseState,
} from "../scripts/release/publication";
test("failed upload resumes same draft; published release is immutable on retry", async () => {
  let state: ReleaseState | null = null;
  let fail = true,
    creates = 0,
    uploads = 0,
    publishes = 0;
  const io = {
    lookup: async () => state,
    createDraft: () => {
      creates++;
      state = { draft: true, html_url: "https://example.invalid/release" };
    },
    uploadAndVerify: async () => {
      uploads++;
      if (fail) throw new Error("network failure");
    },
    publish: () => {
      publishes++;
      state = { draft: false, html_url: "https://example.invalid/release" };
    },
  };
  await expect(publishDraft(io)).rejects.toThrow("network");
  expect(creates).toBe(1);
  expect(publishes).toBe(0);
  fail = false;
  expect(await publishDraft(io)).toBe("https://example.invalid/release");
  expect(creates).toBe(1);
  expect(uploads).toBe(2);
  expect(publishes).toBe(1);
  await publishDraft(io);
  expect(uploads).toBe(2);
  expect(publishes).toBe(1);
});
test("lookup failure never creates a competing release", async () => {
  let writes = 0;
  await expect(
    publishDraft({
      lookup: async () => {
        throw new Error("HTTP 503");
      },
      createDraft: () => {
        writes++;
      },
      uploadAndVerify: async () => {
        writes++;
      },
      publish: () => {
        writes++;
      },
    }),
  ).rejects.toThrow("503");
  expect(writes).toBe(0);
});

test("authenticated release listing finds a draft by tag", async () => {
  const calls: string[] = [];
  const fetcher = async (input: string) => {
    calls.push(String(input));
    return new Response(JSON.stringify([
      { tag_name: "other/v1", draft: false, html_url: "https://example.invalid/other" },
      { tag_name: "blueprint/v0.1.3", draft: true, html_url: "https://example.invalid/draft" },
    ]));
  };
  expect(await findRelease("cododel/repo", "blueprint/v0.1.3", "token", fetcher)).toEqual({
    draft: true,
    html_url: "https://example.invalid/draft",
  });
  expect(calls).toEqual(["https://api.github.com/repos/cododel/repo/releases?per_page=100&page=1"]);
});
test("release list errors stop publication", async () => {
  const fetcher = async () => new Response("Forbidden", { status: 403 });
  await expect(findRelease("cododel/repo", "blueprint/v0.1.3", "token", fetcher)).rejects.toThrow("HTTP 403");
});
