import type { ItunesMatch, Track } from "./types.js";
import {
  isAllowedAppleMusicUrl,
  isAllowedArtworkUrl,
  isAllowedPreviewUrl,
} from "./urls.js";

type ItunesResult = {
  artistName?: string;
  trackName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  trackTimeMillis?: number;
};

const emptyMatch: ItunesMatch = {
  artworkUrl: null,
  previewUrl: null,
  appleMusicUrl: null,
  durationMs: null,
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function sameArtist(lastfm: string, itunes: string | undefined) {
  if (!itunes) return false;
  const a = normalize(lastfm);
  const b = normalize(itunes);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

// the first search result is often a cover or a karaoke version, which would
// bring the wrong artwork and the wrong duration
function pickResult(
  track: Pick<Track, "name" | "artist">,
  results: ItunesResult[],
) {
  const byArtist = results.filter((result) =>
    sameArtist(track.artist, result.artistName),
  );
  const name = normalize(track.name);
  return (
    byArtist.find((result) => normalize(result.trackName ?? "") === name) ??
    byArtist[0]
  );
}

// null means the request failed; emptyMatch means itunes has no such song
export async function findItunesMatch(
  track: Pick<Track, "name" | "artist">,
  { fetcher, timeoutMs }: { fetcher: typeof fetch; timeoutMs: number },
): Promise<ItunesMatch | null> {
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({
    term: `${track.artist} ${track.name}`,
    entity: "song",
    limit: "10",
  }).toString();

  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { results?: ItunesResult[] };
    const result = pickResult(track, data.results ?? []);
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
