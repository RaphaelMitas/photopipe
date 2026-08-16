export const REPO = "https://github.com/RaphaelMitas/photopipe";
const LATEST_JSON = `${REPO}/releases/latest/download/latest.json`;
const RELEASES_PAGE = `${REPO}/releases/latest`;

function versionOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("version" in payload)) return null;
  const { version } = payload;
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version)
    ? version
    : null;
}

export async function downloadUrl(): Promise<string> {
  try {
    const response = await fetch(LATEST_JSON, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return RELEASES_PAGE;
    const version = versionOf(await response.json());
    return version
      ? `${REPO}/releases/download/v${version}/Photopipe-${version}.dmg`
      : RELEASES_PAGE;
  } catch {
    return RELEASES_PAGE;
  }
}
