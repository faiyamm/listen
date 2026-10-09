import { describe, expect, it, vi } from "vitest";

import { createNowPlayingEngine, parseExtras } from "../music.js";

type FakeApis = {
  nowPlaying?: boolean;
  scrobbledAt?: number;
  lastfmDuration?: string;
  durationStatus?: number;
  itunesStatus?: number;
  itunesDurationMs?: number;
};

function fakeFetcher({
  nowPlaying = true,
  scrobbledAt,
  lastfmDuration = "240000",
  durationStatus = 200,
  itunesStatus = 200,
  itunesDurationMs,
}: FakeApis = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.hostname === "itunes.apple.com") {
      if (itunesStatus !== 200)
        return new Response(null, { status: itunesStatus });
      return Response.json({
        results: [
          {
            artworkUrl100:
              "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg/100x100bb.jpg",
            previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
            trackTimeMillis: itunesDurationMs,
            trackViewUrl: "https://music.apple.com/us/album/bbw/1",
          },
        ],
      });
    }

    if (url.searchParams.get("method") === "track.getInfo") {
      if (durationStatus !== 200) {
        return new Response(null, { status: durationStatus });
      }
      return Response.json({ track: { duration: lastfmDuration } });
    }

    return Response.json({
      recenttracks: {
        track: [
          {
            ...(nowPlaying && { "@attr": { nowplaying: "true" } }),
            ...(scrobbledAt !== undefined && {
              date: { uts: String(scrobbledAt / 1000) },
            }),
            artist: { "#text": "Drake" },
            image: [{ "#text": "https://lastfm.freetls.fastly.net/art.jpg" }],
            name: "BBW",
          },
        ],
      },
    });
  });
}

function calls(fetcher: ReturnType<typeof fakeFetcher>, match: string) {
  return fetcher.mock.calls.filter(([input]) => String(input).includes(match))
    .length;
}

function engineWith(fetcher: ReturnType<typeof fakeFetcher>, now = () => 0) {
  return createNowPlayingEngine({
    apiKey: "test-key",
    fetcher: fetcher as unknown as typeof fetch,
    now,
    username: "listener",
  });
}

describe("createNowPlayingEngine", () => {
  it("returns the Last.fm track with its duration and no iTunes data by default", async () => {
    const fetcher = fakeFetcher();

    const track = await engineWith(fetcher).getTrack();

    expect(track).toMatchObject({
      albumArtUrl: "https://lastfm.freetls.fastly.net/art.jpg",
      artist: "Drake",
      durationMs: 240_000,
      lastfmUrl: "https://www.last.fm/music/Drake/_/BBW",
      name: "BBW",
      nowPlaying: true,
    });
    expect(track).not.toHaveProperty("itunes");
    expect(calls(fetcher, "itunes.apple.com")).toBe(0);
  });

  it("keeps a scrobbled track playing until its duration runs out", async () => {
    const scrobbledAt = 1_000_000;
    const fetcher = fakeFetcher({ nowPlaying: false, scrobbledAt });

    const during = await engineWith(
      fetcher,
      () => scrobbledAt + 60_000,
    ).getTrack();
    const after = await engineWith(
      fetcher,
      () => scrobbledAt + 300_000,
    ).getTrack();

    expect(during?.nowPlaying).toBe(true);
    expect(after?.nowPlaying).toBe(false);
  });

  it("adds iTunes extras only when they are requested", async () => {
    const fetcher = fakeFetcher();

    const track = await engineWith(fetcher).getTrack(["itunes"]);

    expect(track?.itunes).toEqual({
      appleMusicUrl: "https://music.apple.com/us/album/bbw/1",
      artworkUrl:
        "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg/600x600bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
    });
  });

  it("falls back to the iTunes duration when Last.fm has none", async () => {
    const fetcher = fakeFetcher({
      itunesDurationMs: 180_000,
      lastfmDuration: "0",
    });

    const track = await engineWith(fetcher).getTrack(["itunes"]);

    expect(track?.durationMs).toBe(180_000);
  });

  it("serves repeat requests from the response cache for five seconds", async () => {
    const fetcher = fakeFetcher();
    let now = 0;
    const engine = engineWith(fetcher, () => now);

    await engine.getTrack();
    now = 4_000;
    await engine.getTrack();
    expect(calls(fetcher, "user.getrecenttracks")).toBe(1);

    now = 6_000;
    await engine.getTrack();
    expect(calls(fetcher, "user.getrecenttracks")).toBe(2);
  });

  it("looks up duration and iTunes once per song", async () => {
    const fetcher = fakeFetcher();
    let now = 0;
    const engine = engineWith(fetcher, () => now);

    await engine.getTrack(["itunes"]);
    now = 10_000;
    await engine.getTrack(["itunes"]);

    expect(calls(fetcher, "user.getrecenttracks")).toBe(2);
    expect(calls(fetcher, "track.getInfo")).toBe(1);
    expect(calls(fetcher, "itunes.apple.com")).toBe(1);
  });

  it("retries lookups that failed instead of caching the failure", async () => {
    const fetcher = fakeFetcher({ durationStatus: 503, itunesStatus: 503 });
    let now = 0;
    const engine = engineWith(fetcher, () => now);

    const first = await engine.getTrack(["itunes"]);
    now = 10_000;
    await engine.getTrack(["itunes"]);

    expect(first?.durationMs).toBeNull();
    expect(first?.itunes?.previewUrl).toBeNull();
    expect(calls(fetcher, "track.getInfo")).toBe(2);
    expect(calls(fetcher, "itunes.apple.com")).toBe(2);
  });
});

describe("parseExtras", () => {
  it("keeps known extras and ignores the rest", () => {
    expect(parseExtras(null)).toEqual([]);
    expect(parseExtras("itunes")).toEqual(["itunes"]);
    expect(parseExtras(" itunes ,spotify")).toEqual(["itunes"]);
    expect(parseExtras("spotify")).toEqual([]);
  });
});
