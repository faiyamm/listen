import type { LastfmTrack } from "./types.js";
import { isAllowedArtworkUrl } from "./urls.js";

type LastfmResponse = {
  recenttracks?: {
    track?: Array<{
      name?: string;
      artist?: { "#text"?: string };
      image?: Array<{ "#text"?: string }>;
      date?: { uts?: string };
      "@attr"?: { nowplaying?: string };
    }>;
  };
};

const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";

// throws on transport errors so callers can tell "last.fm has no duration"
// (cacheable) apart from "the request failed" (worth retrying)
export async function fetchLastfmDurationMs({
  apiKey,
  artist,
  name,
  fetcher = fetch,
}: {
  apiKey: string;
  artist: string;
  name: string;
  fetcher?: typeof fetch;
}): Promise<number | null> {
  const url = new URL(LASTFM_API_URL);
  url.search = new URLSearchParams({
    method: "track.getInfo",
    artist,
    track: name,
    api_key: apiKey,
    format: "json",
    autocorrect: "1",
  }).toString();

  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Last.fm track.getInfo failed with ${response.status}`);
  }

  const data = (await response.json()) as { track?: { duration?: string } };
  const durationMs = Number.parseInt(data.track?.duration ?? "", 10);
  return durationMs > 0 ? durationMs : null;
}

export async function fetchLastfmTrack({
  apiKey,
  username,
  fetcher = fetch,
}: {
  apiKey: string;
  username: string;
  fetcher?: typeof fetch;
}): Promise<LastfmTrack | null> {
  const url = new URL(LASTFM_API_URL);
  url.search = new URLSearchParams({
    method: "user.getrecenttracks",
    user: username,
    api_key: apiKey,
    format: "json",
    limit: "1",
  }).toString();

  try {
    const response = await fetcher(url);
    if (!response.ok) return null;
    const data = (await response.json()) as LastfmResponse;
    const track = data.recenttracks?.track?.[0];
    const name = track?.name?.trim();
    const artist = track?.artist?.["#text"]?.trim();
    if (!track || !name || !artist) return null;

    const image = [...(track.image ?? [])]
      .reverse()
      .map((item) => item["#text"] ?? "")
      .find(isAllowedArtworkUrl);

    return {
      name,
      artist,
      albumArtUrl: image ?? null,
      nowPlaying: track?.["@attr"]?.nowplaying === "true",
      scrobbledAt: track?.date?.uts
        ? Number.parseInt(track?.date.uts, 10) * 1000
        : null,
    };
  } catch {
    return null;
  }
}
