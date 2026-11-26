import { createSharedCalls } from "./cache.js";
import { findItunesMatch } from "./itunes.js";
import { fetchLastfmDurationMs, fetchLastfmTrack } from "./lastfm.js";
import { fetchListenbrainzTrack } from "./listenbrainz.js";
import {
  EXTRAS,
  type Extra,
  type ItunesMatch,
  type SourceTrack,
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

export type EngineOptions = (
  | { service?: "lastfm"; apiKey: string; username: string }
  | { service: "listenbrainz"; username: string }
) & {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

export function createNowPlayingEngine(
  options: EngineOptions,
): NowPlayingEngine {
  const {
    username,
    fetcher = fetch,
    now = Date.now,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const service = options.service ?? "lastfm";
  const serviceName = service === "listenbrainz" ? "ListenBrainz" : "Last.fm";
  const apiKey = "apiKey" in options ? options.apiKey : "";

  if (service !== "lastfm" && service !== "listenbrainz") {
    throw new TypeError(
      `service must be "lastfm" or "listenbrainz", got ${String(service)}`,
    );
  }
  if (service === "lastfm" && (typeof apiKey !== "string" || !apiKey.trim())) {
    throw new TypeError("createNowPlayingEngine needs a Last.fm apiKey");
  }
  // "." and ".." would turn the listenbrainz url into another endpoint
  if (
    typeof username !== "string" ||
    !username.trim() ||
    /^\.{1,2}$/.test(username.trim())
  ) {
    throw new TypeError(
      `createNowPlayingEngine needs a ${serviceName} username`,
    );
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
  const recentTracks = createSharedCalls<SourceTrack | null>({
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

  function getDurationMs(track: SourceTrack) {
    if (service === "listenbrainz") return track.durationMs ?? null;
    const { artist, name } = track;
    return durations(lookupKey(artist, name), () =>
      fetchLastfmDurationMs({ ...request, artist, name }),
    ).catch(() => null);
  }

  function fetchRecentTrack() {
    return service === "listenbrainz"
      ? fetchListenbrainzTrack({ username, fetcher, timeoutMs })
      : fetchLastfmTrack({ ...request, username });
  }

  function getItunesMatch(artist: string, name: string) {
    return itunesMatches(lookupKey(artist, name), () =>
      findItunesMatch({ artist, name }, request),
    ).catch(() => null);
  }

  return {
    async getTrack({ extras = [] } = {}) {
      const recent = await recentTracks("recent", fetchRecentTrack);
      if (!recent) return null;

      const wantsItunes = extras.includes("itunes");
      const [sourceDurationMs, itunes] = await Promise.all([
        getDurationMs(recent),
        wantsItunes ? getItunesMatch(recent.artist, recent.name) : null,
      ]);
      const durationMs = sourceDurationMs ?? itunes?.durationMs ?? null;

      return {
        id: trackId(recent.artist, recent.name),
        name: recent.name,
        artist: recent.artist,
        albumArtUrl: recent.albumArtUrl,
        scrobbledAt: recent.scrobbledAt,
        lastfmUrl: lastfmTrackUrl(recent.artist, recent.name),
        durationMs,
        nowPlaying:
          recent.nowPlaying ||
          isWithinPlayback(recent.scrobbledAt, durationMs, now()),
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
