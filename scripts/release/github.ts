import type { ReleaseState } from "./publication";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// GitHub's release-by-tag endpoint does not return draft releases. The list
// endpoint includes drafts for the authenticated release workflow.
export async function findRelease(repo: string, tag: string, token: string, fetcher: Fetcher = fetch): Promise<ReleaseState | null> {
  for (let page = 1; page <= 100; page++) {
    const response = await fetcher(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`Release lookup HTTP ${response.status}`);
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) throw new Error("Bad release list response");
    const match = releases.find((release) => release?.tag_name === tag);
    if (match) {
      if (typeof match.draft !== "boolean" || typeof match.html_url !== "string") throw new Error("Bad release response");
      return { draft: match.draft, html_url: match.html_url };
    }
    if (releases.length < 100) return null;
  }
  throw new Error("Release lookup exceeded 100 pages");
}
