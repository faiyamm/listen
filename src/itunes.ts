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

// credited artists on the itunes side, as in "A feat. B", "A & B" or "A, B".
// the lookahead keeps words like "featuring" and "feather" whole
const CREDIT_SEPARATOR = /\s*(?:,|&|\b(?:featuring|feat\.?|ft\.?)(?=\s|$))\s*/i;
// the featured part of a last.fm artist name, as in "A feat. B"
const FEATURED = /\s+(?:featuring|feat\.?|ft\.?)\s.*$/i;
// words that mark a version of the same song, not a different song
const VERSION_WORDS =
  /\b(?:remaster(?:ed)?|live|radio edit|edit|mono|stereo|version|deluxe|explicit|clean|single|acoustic|bonus track|feat\.?|ft\.?|featuring|with)\b/i;

function normalize(value: string) {
  const letters = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  // a name made only of symbols, like "!!!", still has to match itself
  return letters || value.trim().toLowerCase();
}

// last.fm's whole name and its lead artist; a comma or "&" can be part of a
// band's name ("Earth, Wind & Fire"), so only a featured credit is split off
function lastfmArtistNames(value: string) {
  return new Set([normalize(value), normalize(value.replace(FEATURED, ""))]);
}

function itunesArtistNames(value: string) {
  return [value, ...value.split(CREDIT_SEPARATOR)]
    .filter(Boolean)
    .map(normalize);
}

function sameArtist(lastfm: string, itunes: string | undefined) {
  if (!itunes) return false;
  const names = lastfmArtistNames(lastfm);
  return itunesArtistNames(itunes).some((name) => names.has(name));
}

// drops "(Live)", "[Remastered 2011]", "- Radio Edit" or "feat. B", but keeps
// "(Reprise)" or "- Pt. 2", which are different songs
function baseTitle(value: string) {
  return normalize(
    value
      .replace(/\s*(?:\([^)]*\)|\[[^\]]*\])/g, (part) =>
        VERSION_WORDS.test(part) ? "" : part,
      )
      .replace(/\s+-\s+(.*)$/, (part, rest: string) =>
        VERSION_WORDS.test(rest) ? "" : part,
      )
      .replace(FEATURED, ""),
  );
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
  const exactMatch = byArtist.find(
    (result) => normalize(result.trackName ?? "") === exact,
  );
  if (exactMatch) return exactMatch;

  const base = baseTitle(track.name);
  if (!base) return undefined;
  const sameSong = byArtist.filter(
    (result) => baseTitle(result.trackName ?? "") === base,
  );
  // the plain title first, so "Song" wins over "Song (Live)"
  return (
    sameSong.find((result) => normalize(result.trackName ?? "") === base) ??
    sameSong[0]
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
