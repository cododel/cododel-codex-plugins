export interface ReleaseState {
  draft: boolean;
  html_url: string;
}
export interface Publication {
  lookup(): Promise<ReleaseState | null>;
  createDraft(): void;
  uploadAndVerify(): Promise<void>;
  publish(): void;
}
// All operations target one existing, verified Git tag. On an uncertain failure,
// the next run reads GitHub state again before deciding what still needs doing.
export async function publishDraft(io: Publication): Promise<string> {
  const existing = await io.lookup();
  if (existing && !existing.draft) return existing.html_url;
  if (!existing) io.createDraft();
  await io.uploadAndVerify();
  io.publish();
  const result = await io.lookup();
  if (!result || result.draft) throw new Error("Release was not published");
  return result.html_url;
}
