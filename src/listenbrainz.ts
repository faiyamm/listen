import type { SourceTrack } from "./types.js";
import { isAllowedArtworkUrl } from "./urls.js";

type Listen = {
  listened_at?: number;
  track_metadata?: {
    artist_name?: string;
    track_name?: string;
    additional_info?: { duration_ms?: unknown; duration?: unknown };
    mbid_mapping?: { caa_id?: unknown; caa_release_mbid?: unknown };
  };
};

type ListensResponse = { payload?: { listens?: Listen[] } };

const LISTENBRAINZ_API_URL = "https://api.listenbrainz.org/1/user/";
// listenbrainz may block requests without an identifying user agent
const USER_AGENT = "actkool-listen/0.3.0 ( https://github.com/faiyamm/listen )";
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Request = {
  username: string;
  fetcher: typeof fetch;
  timeoutMs: number;
};

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function durationMs(info: { duration_ms?: unknown; duration?: unknown } = {}) {
  const seconds = positive(info.duration);
  return positive(info.duration_ms) ?? (seconds && seconds * 1000);
}

function coverArtUrl(
  mapping: { caa_id?: unknown; caa_release_mbid?: unknown } = {},
) {
  const release = asText(mapping.caa_release_mbid);
  const id = mapping.caa_id;
  if (!MBID.test(release) || !Number.isSafeInteger(id) || (id as number) <= 0) {
    return null;
  }
  const url = `https://coverartarchive.org/release/${release}/${id}-500.jpg`;
  return isAllowedArtworkUrl(url) ? url : null;
}

async function fetchLatestListen(
  { username, fetcher, timeoutMs }: Request,
  path: "playing-now" | "listens",
) {
  const url = new URL(
    `${encodeURIComponent(username)}/${path}`,
    LISTENBRAINZ_API_URL,
  );
  if (path === "listens") url.searchParams.set("count", "1");

  const response = await fetcher(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await response
    .json()
    .catch(() => null)) as ListensResponse | null;
  if (!response.ok || !Array.isArray(data?.payload?.listens)) {
    throw new Error(`ListenBrainz ${path} failed with ${response.status}`);
  }

  const listen = data.payload.listens[0];
  const name = asText(listen?.track_metadata?.track_name);
  const artist = asText(listen?.track_metadata?.artist_name);
  if (!listen || !name || !artist) return null;

  const listenedAt = positive(listen.listened_at);
  return {
    name,
    artist,
    albumArtUrl: coverArtUrl(listen.track_metadata?.mbid_mapping),
    scrobbledAt: listenedAt && listenedAt * 1000,
    durationMs: durationMs(listen.track_metadata?.additional_info),
  };
}

// playing-now never carries cover art, but most scrobblers also submit the
// listen when the song starts, and that one is matched to a release
export async function fetchListenbrainzTrack(
  request: Request,
): Promise<SourceTrack | null> {
  const [playing, latest] = await Promise.all([
    fetchLatestListen(request, "playing-now"),
    fetchLatestListen(request, "listens"),
  ]);

  if (playing) {
    const sameSong =
      latest?.name === playing.name && latest.artist === playing.artist;
    return {
      ...playing,
      albumArtUrl: sameSong ? latest.albumArtUrl : null,
      durationMs: playing.durationMs ?? (sameSong ? latest.durationMs : null),
      nowPlaying: true,
      scrobbledAt: null,
    };
  }

  return latest && { ...latest, nowPlaying: false };
}
