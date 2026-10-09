import type { ItunesMatch, Track } from "./types.js";
import {
  isAllowedAppleMusicUrl,
  isAllowedArtworkUrl,
  isAllowedPreviewUrl,
} from "./urls.js";

const emptyMatch: ItunesMatch = {
  artworkUrl: null,
  previewUrl: null,
  appleMusicUrl: null,
  durationMs: null,
};

// null means the request failed; emptyMatch means itunes has no such song
export async function findItunesMatch(
  track: Pick<Track, "name" | "artist">,
  fetcher: typeof fetch = fetch,
): Promise<ItunesMatch | null> {
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({
    term: `${track.artist} ${track.name}`,
    entity: "song",
    limit: "1",
  }).toString();

  try {
    const response = await fetcher(url);
    if (!response.ok) return null;
    const data = (await response.json()) as {
      results?: Array<{
        artworkUrl100?: string;
        previewUrl?: string;
        trackViewUrl?: string;
        trackTimeMillis?: number;
      }>;
    };
    const result = data.results?.[0];
    if (!result) return emptyMatch;
    const artworkUrl = result.artworkUrl100?.replace("100x100bb", "600x600bb");

    return {
      artworkUrl:
        artworkUrl && isAllowedArtworkUrl(artworkUrl) ? artworkUrl : null,
      previewUrl:
        result.previewUrl && isAllowedPreviewUrl(result.previewUrl)
          ? result.previewUrl
          : null,
      appleMusicUrl:
        result.trackViewUrl && isAllowedAppleMusicUrl(result.trackViewUrl)
          ? result.trackViewUrl
          : null,
      durationMs:
        typeof result.trackTimeMillis === "number"
          ? result.trackTimeMillis
          : null,
    };
  } catch {
    return null;
  }
}
