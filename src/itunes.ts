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

// featured or credited artists, as in "A feat. B" or "A & B"
const ARTIST_SEPARATOR = /\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i;
// "(Live)", "[Remastered 2011]", "- Radio Edit", "feat. B"
const TITLE_EXTRAS = /\s*(?:\([^)]*\)|\[[^\]]*\]|\s-\s.*$|\bfeat\.?\s.*$)/gi;

function normalize(value: string) {
  const letters = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  // a name made only of symbols, like "!!!", still has to match itself
  return letters || value.trim().toLowerCase();
}

function artistNames(value: string) {
  return new Set(
    [value, ...value.split(ARTIST_SEPARATOR)].map(normalize).filter(Boolean),
  );
}

function sameArtist(lastfm: string, itunes: string | undefined) {
  if (!itunes) return false;
  const names = artistNames(lastfm);
  return [...artistNames(itunes)].some((name) => names.has(name));
}

function baseTitle(value: string) {
  return normalize(value.replace(TITLE_EXTRAS, ""));
}

// the first search result is often a cover, a karaoke version or another
// song by the same artist, which would bring the wrong artwork and duration
function pickResult(
  track: Pick<Track, "name" | "artist">,
  results: ItunesResult[],
) {
  const byArtist = results.filter((result) =>
    sameArtist(track.artist, result.artistName),
  );
  const exact = normalize(track.name);
  const base = baseTitle(track.name);
  return (
    byArtist.find((result) => normalize(result.trackName ?? "") === exact) ??
    byArtist.find((result) => baseTitle(result.trackName ?? "") === base)
  );
}

// throws when the request fails; emptyMatch means itunes has no such song
export async function findItunesMatch(
  track: Pick<Track, "name" | "artist">,
  { fetcher, timeoutMs }: { fetcher: typeof fetch; timeoutMs: number },
): Promise<ItunesMatch> {
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({
    term: `${track.artist} ${track.name}`,
    entity: "song",
    limit: "10",
  }).toString();

  const response = await fetcher(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`iTunes search failed with ${response.status}`);
  }
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
}
