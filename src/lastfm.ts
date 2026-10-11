import type { LastfmTrack } from "./types.js";
import { isAllowedArtworkUrl } from "./urls.js";

type LastfmError = { error?: number; message?: string };

type LastfmResponse = LastfmError & {
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
const LASTFM_NOT_FOUND = 6;
// last.fm serves this grey star instead of an empty image when a track has no art
const PLACEHOLDER_ARTWORK = "2a96cbd8b46e442fc41c2b86b821562f";

type Request = {
  apiKey: string;
  fetcher: typeof fetch;
  timeoutMs: number;
};

// the api is typed, but a field that isn't a string must not throw
function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function callLastfm<T>(
  { apiKey, fetcher, timeoutMs }: Request,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: (T & LastfmError) | null }> {
  const url = new URL(LASTFM_API_URL);
  url.search = new URLSearchParams({
    ...params,
    api_key: apiKey,
    format: "json",
  }).toString();

  const response = await fetcher(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await response.json().catch(() => null)) as
    (T & LastfmError) | null;
  return { ok: response.ok, status: response.status, data };
}

function lastfmFailure(
  method: string,
  status: number,
  data: LastfmError | null,
) {
  const detail = data?.error ? ` (error ${data.error}: ${data.message})` : "";
  return new Error(`Last.fm ${method} failed with ${status}${detail}`);
}

// throws on transport errors so callers can tell "last.fm has no duration"
// (cacheable) apart from "the request failed" (worth retrying)
export async function fetchLastfmDurationMs({
  artist,
  name,
  ...request
}: Request & { artist: string; name: string }): Promise<number | null> {
  const { ok, status, data } = await callLastfm<{
    track?: { duration?: string };
  }>(request, {
    method: "track.getInfo",
    artist,
    track: name,
    autocorrect: "1",
  });

  if (data?.error === LASTFM_NOT_FOUND) return null;
  if (!ok || !data || data.error) {
    throw lastfmFailure("track.getInfo", status, data);
  }

  const durationMs = Number.parseInt(data.track?.duration ?? "", 10);
  return durationMs > 0 ? durationMs : null;
}

// null means the account has nothing scrobbled; a failed request throws
export async function fetchLastfmTrack({
  username,
  ...request
}: Request & { username: string }): Promise<LastfmTrack | null> {
  const { ok, status, data } = await callLastfm<LastfmResponse>(request, {
    method: "user.getrecenttracks",
    user: username,
    limit: "1",
  });

  if (!ok || !data?.recenttracks || data.error) {
    throw lastfmFailure("user.getrecenttracks", status, data);
  }

  const track = data.recenttracks.track?.[0];
  const name = asText(track?.name);
  const artist = asText(track?.artist?.["#text"]);
  if (!track || !name || !artist) return null;

  const image = [...(track.image ?? [])]
    .reverse()
    .map((item) => asText(item?.["#text"]))
    .find(
      (url) => isAllowedArtworkUrl(url) && !url.includes(PLACEHOLDER_ARTWORK),
    );
  const uts = Number.parseInt(track.date?.uts ?? "", 10);

  return {
    name,
    artist,
    albumArtUrl: image ?? null,
    nowPlaying: track["@attr"]?.nowplaying === "true",
    scrobbledAt: uts > 0 ? uts * 1000 : null,
  };
}
