import { createTtlCache } from "./cache.js";
import { findItunesMatch } from "./itunes.js";
import { fetchLastfmDurationMs, fetchLastfmTrack } from "./lastfm.js";
import { EXTRAS, type Extra, type ItunesMatch, type Track } from "./types.js";
import { lastfmTrackUrl } from "./urls.js";

const RESPONSE_TTL_MS = 5_000;
const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;

export type NowPlayingEngine = {
  getTrack(extras?: readonly Extra[]): Promise<Track | null>;
};

export function parseExtras(value: string | null): Extra[] {
  if (!value) return [];
  const requested = new Set(value.split(",").map((extra) => extra.trim()));
  return EXTRAS.filter((extra) => requested.has(extra));
}

function trackKey(artist: string, name: string) {
  return `${artist}\u0000${name}`;
}

function isWithinPlayback(
  scrobbledAt: number | null,
  durationMs: number | null,
  now: number,
) {
  return (
    scrobbledAt !== null &&
    durationMs !== null &&
    now < scrobbledAt + durationMs
  );
}

export function createNowPlayingEngine({
  apiKey,
  username,
  fetcher = fetch,
  now = Date.now,
}: {
  apiKey: string;
  username: string;
  fetcher?: typeof fetch;
  now?: () => number;
}): NowPlayingEngine {
  const responses = createTtlCache<Track | null>({
    ttlMs: RESPONSE_TTL_MS,
    now,
  });
  const durations = createTtlCache<number | null>({
    ttlMs: LOOKUP_TTL_MS,
    now,
  });
  const itunesMatches = createTtlCache<ItunesMatch>({
    ttlMs: LOOKUP_TTL_MS,
    now,
  });

  async function getDurationMs(artist: string, name: string) {
    const key = trackKey(artist, name);
    const cached = durations.get(key);
    if (cached) return cached.value;

    try {
      const durationMs = await fetchLastfmDurationMs({
        apiKey,
        artist,
        name,
        fetcher,
      });
      durations.set(key, durationMs);
      return durationMs;
    } catch {
      return null;
    }
  }

  async function getItunesMatch(artist: string, name: string) {
    const key = trackKey(artist, name);
    const cached = itunesMatches.get(key);
    if (cached) return cached.value;

    const match = await findItunesMatch({ artist, name }, fetcher);
    if (match) itunesMatches.set(key, match);
    return match;
  }

  async function resolveTrack(extras: readonly Extra[]): Promise<Track | null> {
    const lastfm = await fetchLastfmTrack({ apiKey, username, fetcher });
    if (!lastfm) return null;

    const wantsItunes = extras.includes("itunes");
    const [lastfmDurationMs, itunes] = await Promise.all([
      getDurationMs(lastfm.artist, lastfm.name),
      wantsItunes ? getItunesMatch(lastfm.artist, lastfm.name) : null,
    ]);
    const durationMs = lastfmDurationMs ?? itunes?.durationMs ?? null;

    return {
      id: trackKey(lastfm.artist, lastfm.name),
      ...lastfm,
      lastfmUrl: lastfmTrackUrl(lastfm.artist, lastfm.name),
      durationMs,
      nowPlaying:
        lastfm.nowPlaying ||
        isWithinPlayback(lastfm.scrobbledAt, durationMs, now()),
      ...(wantsItunes && {
        itunes: {
          artworkUrl: itunes?.artworkUrl ?? null,
          previewUrl: itunes?.previewUrl ?? null,
          appleMusicUrl: itunes?.appleMusicUrl ?? null,
        },
      }),
    };
  }

  return {
    async getTrack(extras = []) {
      const key = [...extras].sort().join(",");
      const cached = responses.get(key);
      if (cached) return cached.value;

      const track = await resolveTrack(extras);
      responses.set(key, track);
      return track;
    },
  };
}
