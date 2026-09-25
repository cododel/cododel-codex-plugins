import type { ReleaseState } from "./publication";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// GitHub's release-by-tag endpoint does not return draft releases. The list
// endpoint includes drafts for the authenticated release workflow.
export async function findRelease(repo: string, tag: string, token: string, fetcher: Fetcher = fetch): Promise<ReleaseState | null> {
  let draft: ReleaseState | null = null;
  let draftCount = 0;
  for (let page = 1; page <= 100; page++) {
    const response = await fetcher(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`Release lookup HTTP ${response.status}`);
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) throw new Error("Bad release list response");
    for (const match of releases.filter((release) => release?.tag_name === tag)) {
      if (typeof match.draft !== "boolean" || typeof match.html_url !== "string") throw new Error("Bad release response");
      if (!match.draft) return { draft: false, html_url: match.html_url };
      draftCount++;
      draft = { draft: true, html_url: match.html_url };
    }
    if (releases.length < 100) {
      if (draftCount > 1) throw new Error("Ambiguous draft releases for tag");
      return draft;
    }
  }
  throw new Error("Release lookup exceeded 100 pages");
}
