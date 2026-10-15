import { createSharedCalls } from "./cache.js";
import { findItunesMatch } from "./itunes.js";
import { fetchLastfmDurationMs, fetchLastfmTrack } from "./lastfm.js";
import {
  EXTRAS,
  type Extra,
  type ItunesMatch,
  type LastfmTrack,
  type Track,
} from "./types.js";
import { isWithinPlayback } from "./playback.js";
import { lastfmTrackUrl } from "./urls.js";

const RESPONSE_TTL_MS = 5_000;
const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_FAILURE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
// a call gives up a little after its own request timeout, in case a custom
// fetcher ignores the abort signal
const DEADLINE_MARGIN_MS = 1_000;

export type GetTrackOptions = {
  extras?: readonly Extra[];
};

export type NowPlayingEngine = {
  getTrack(options?: GetTrackOptions): Promise<Track | null>;
};

export function parseExtras(value: string | null): Extra[] {
  if (!value) return [];
  const requested = new Set(value.split(",").map((extra) => extra.trim()));
  return EXTRAS.filter((extra) => requested.has(extra));
}

function lookupKey(artist: string, name: string) {
  return `${artist}\u0000${name}`;
}

function trackId(artist: string, name: string) {
  return `${encodeURIComponent(artist)}/${encodeURIComponent(name)}`;
}

export function createNowPlayingEngine({
  apiKey,
  username,
  fetcher = fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  apiKey: string;
  username: string;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}): NowPlayingEngine {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new TypeError("createNowPlayingEngine needs a Last.fm apiKey");
  }
  if (typeof username !== "string" || !username.trim()) {
    throw new TypeError("createNowPlayingEngine needs a Last.fm username");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `timeoutMs must be a positive number of milliseconds, got ${timeoutMs}`,
    );
  }

  const request = { apiKey, fetcher, timeoutMs };
  const deadlineMs = timeoutMs + DEADLINE_MARGIN_MS;
  // failures are kept too, so an outage or a rate limit isn't hit again by
  // every poll from every visitor
  const recentTracks = createSharedCalls<LastfmTrack | null>({
    ttlMs: RESPONSE_TTL_MS,
    failureTtlMs: RESPONSE_TTL_MS,
    deadlineMs,
    now,
  });
  const durations = createSharedCalls<number | null>({
    ttlMs: LOOKUP_TTL_MS,
    failureTtlMs: LOOKUP_FAILURE_TTL_MS,
    deadlineMs,
    now,
  });
  const itunesMatches = createSharedCalls<ItunesMatch>({
    ttlMs: LOOKUP_TTL_MS,
    failureTtlMs: LOOKUP_FAILURE_TTL_MS,
    deadlineMs,
    now,
  });

  function getDurationMs(artist: string, name: string) {
    return durations(lookupKey(artist, name), () =>
      fetchLastfmDurationMs({ ...request, artist, name }),
    ).catch(() => null);
  }

  function getItunesMatch(artist: string, name: string) {
    return itunesMatches(lookupKey(artist, name), () =>
      findItunesMatch({ artist, name }, request),
    ).catch(() => null);
  }

  return {
    async getTrack({ extras = [] } = {}) {
      const lastfm = await recentTracks("recent", () =>
        fetchLastfmTrack({ ...request, username }),
      );
      if (!lastfm) return null;

      const wantsItunes = extras.includes("itunes");
      const [lastfmDurationMs, itunes] = await Promise.all([
        getDurationMs(lastfm.artist, lastfm.name),
        wantsItunes ? getItunesMatch(lastfm.artist, lastfm.name) : null,
      ]);
      const durationMs = lastfmDurationMs ?? itunes?.durationMs ?? null;

      return {
        id: trackId(lastfm.artist, lastfm.name),
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
    },
  };
}
