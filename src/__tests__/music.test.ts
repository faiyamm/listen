import { describe, expect, it, vi } from "vitest";

import { createNowPlayingEngine, parseExtras } from "../music.js";

type ItunesResult = {
  artistName?: string;
  trackName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  trackTimeMillis?: number;
};

type FakeApis = {
  nowPlaying?: boolean;
  scrobbledAt?: number;
  recentStatus?: number;
  recentBody?: unknown;
  images?: string[];
  lastfmDuration?: string;
  durationStatus?: number;
  durationBody?: unknown;
  itunesStatus?: number;
  itunesDurationMs?: number;
  itunesResults?: ItunesResult[];
};

const DRAKE_RESULT: ItunesResult = {
  artistName: "Drake",
  trackName: "BBW",
  artworkUrl100:
    "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg/100x100bb.jpg",
  previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
  trackViewUrl: "https://music.apple.com/us/album/bbw/1",
};

function fakeFetcher({
  nowPlaying = true,
  scrobbledAt,
  recentStatus = 200,
  recentBody,
  images = ["https://lastfm.freetls.fastly.net/art.jpg"],
  lastfmDuration = "240000",
  durationStatus = 200,
  durationBody,
  itunesStatus = 200,
  itunesDurationMs,
  itunesResults,
}: FakeApis = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.hostname === "itunes.apple.com") {
      if (itunesStatus !== 200)
        return new Response(null, { status: itunesStatus });
      return Response.json({
        results: itunesResults ?? [
          { ...DRAKE_RESULT, trackTimeMillis: itunesDurationMs },
        ],
      });
    }

    if (url.searchParams.get("method") === "track.getInfo") {
      return Response.json(
        durationBody ?? { track: { duration: lastfmDuration } },
        { status: durationStatus },
      );
    }

    if (recentBody !== undefined || recentStatus !== 200) {
      return Response.json(recentBody ?? { error: 8, message: "down" }, {
        status: recentStatus,
      });
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
            image: images.map((image) => ({ "#text": image })),
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

function engineWith(
  fetcher: ReturnType<typeof fakeFetcher>,
  now = () => 0,
  timeoutMs?: number,
) {
  return createNowPlayingEngine({
    apiKey: "test-key",
    fetcher: fetcher as unknown as typeof fetch,
    now,
    timeoutMs,
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
      id: "Drake/BBW",
      lastfmUrl: "https://www.last.fm/music/Drake/_/BBW",
      name: "BBW",
      nowPlaying: true,
      scrobbledAt: null,
    });
    expect(track).not.toHaveProperty("itunes");
    expect(calls(fetcher, "itunes.apple.com")).toBe(0);
  });

  it("builds an id that is safe for URLs and the DOM", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        recenttracks: {
          track: [{ artist: { "#text": "AC/DC" }, name: "T.N.T. #1" }],
        },
      }),
    );

    const track = await engineWith(fetcher).getTrack();

    expect(track?.id).toBe("AC%2FDC/T.N.T.%20%231");
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

    expect(during).toMatchObject({ nowPlaying: true, scrobbledAt });
    expect(after?.nowPlaying).toBe(false);
  });

  it("returns null when the account has nothing scrobbled", async () => {
    const fetcher = fakeFetcher({
      recentBody: { recenttracks: { track: [] } },
    });

    await expect(engineWith(fetcher).getTrack()).resolves.toBeNull();
  });

  it("throws when Last.fm can't be reached, so the route can report an error", async () => {
    const unavailable = fakeFetcher({ recentStatus: 503 });
    const rateLimited = fakeFetcher({
      recentBody: { error: 29, message: "Rate limit exceeded" },
    });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(engineWith(unavailable).getTrack()).rejects.toThrow("503");
    await expect(engineWith(rateLimited).getTrack()).rejects.toThrow(
      "error 29",
    );
    await expect(engineWith(offline).getTrack()).rejects.toThrow(
      "fetch failed",
    );
  });

  it("gives up on a Last.fm request that hangs", async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    await expect(
      engineWith(fetcher, Date.now, 20).getTrack(),
    ).rejects.toThrow();
  });

  it("skips the grey star Last.fm sends when a track has no artwork", async () => {
    const fetcher = fakeFetcher({
      images: [
        "https://lastfm.freetls.fastly.net/i/u/34s/2a96cbd8b46e442fc41c2b86b821562f.png",
        "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png",
      ],
    });

    const track = await engineWith(fetcher).getTrack();

    expect(track?.albumArtUrl).toBeNull();
  });

  it("adds iTunes extras only when they are requested", async () => {
    const fetcher = fakeFetcher();

    const track = await engineWith(fetcher).getTrack({ extras: ["itunes"] });

    expect(track?.itunes).toEqual({
      appleMusicUrl: "https://music.apple.com/us/album/bbw/1",
      artworkUrl:
        "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg/600x600bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
    });
  });

  it("picks the iTunes result by the same artist, not the first one", async () => {
    const fetcher = fakeFetcher({
      itunesResults: [
        {
          ...DRAKE_RESULT,
          artistName: "Karaoke Hits Band",
          trackViewUrl: "https://music.apple.com/us/album/karaoke/9",
        },
        { ...DRAKE_RESULT, trackName: "BBW (Live)" },
        DRAKE_RESULT,
      ],
    });

    const track = await engineWith(fetcher).getTrack({ extras: ["itunes"] });

    expect(track?.itunes?.appleMusicUrl).toBe(
      "https://music.apple.com/us/album/bbw/1",
    );
  });

  it("leaves the iTunes extras empty when no result is by the artist", async () => {
    const fetcher = fakeFetcher({
      itunesResults: [{ ...DRAKE_RESULT, artistName: "Someone Else" }],
    });

    const track = await engineWith(fetcher).getTrack({ extras: ["itunes"] });

    expect(track?.itunes).toEqual({
      appleMusicUrl: null,
      artworkUrl: null,
      previewUrl: null,
    });
  });

  it("doesn't match an artist whose name only contains the one on Last.fm", async () => {
    const fetcher = fakeFetcher({
      itunesResults: [{ ...DRAKE_RESULT, artistName: "Drake Bell" }],
    });

    const track = await engineWith(fetcher).getTrack({ extras: ["itunes"] });

    expect(track?.itunes?.appleMusicUrl).toBeNull();
  });

  it("matches a featured artist and a title with a version suffix", async () => {
    const fetcher = fakeFetcher({
      itunesResults: [
        {
          ...DRAKE_RESULT,
          artistName: "Future & Drake",
          trackName: "BBW (Remastered 2011)",
        },
      ],
    });

    const track = await engineWith(fetcher).getTrack({ extras: ["itunes"] });

    expect(track?.itunes?.appleMusicUrl).toBe(
      "https://music.apple.com/us/album/bbw/1",
    );
  });

  it("never takes another song by the same artist", async () => {
    const fetcher = fakeFetcher({
      itunesDurationMs: 999_000,
      itunesResults: [{ ...DRAKE_RESULT, trackName: "Hotline Bling" }],
      lastfmDuration: "0",
    });

    const track = await engineWith(fetcher).getTrack({ extras: ["itunes"] });

    expect(track?.itunes?.appleMusicUrl).toBeNull();
    expect(track?.durationMs).toBeNull();
  });

  it("falls back to the iTunes duration when Last.fm has none", async () => {
    const fetcher = fakeFetcher({
      itunesDurationMs: 180_000,
      lastfmDuration: "0",
    });

    const track = await engineWith(fetcher).getTrack({ extras: ["itunes"] });

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

  it("shares one Last.fm call between requests that arrive together", async () => {
    const fetcher = fakeFetcher();
    const engine = engineWith(fetcher);

    await Promise.all([
      engine.getTrack(),
      engine.getTrack(),
      engine.getTrack(),
    ]);

    expect(calls(fetcher, "user.getrecenttracks")).toBe(1);
  });

  it("reuses a Last.fm failure for five seconds instead of retrying every poll", async () => {
    const fetcher = fakeFetcher({ recentStatus: 503 });
    let now = 0;
    const engine = engineWith(fetcher, () => now);

    await expect(engine.getTrack()).rejects.toThrow();
    now = 4_000;
    await expect(engine.getTrack()).rejects.toThrow();
    expect(calls(fetcher, "user.getrecenttracks")).toBe(1);

    now = 6_000;
    await expect(engine.getTrack()).rejects.toThrow();
    expect(calls(fetcher, "user.getrecenttracks")).toBe(2);
  });

  it("shares the Last.fm call between requests with different extras", async () => {
    const fetcher = fakeFetcher();
    const engine = engineWith(fetcher);

    await Promise.all([
      engine.getTrack(),
      engine.getTrack({ extras: ["itunes"] }),
    ]);

    expect(calls(fetcher, "user.getrecenttracks")).toBe(1);
    expect(calls(fetcher, "track.getInfo")).toBe(1);
  });

  it("reuses a timed-out Last.fm call for five seconds after it gives up", async () => {
    let now = 0;
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            now += 5_000;
            reject(init.signal?.reason);
          });
        }),
    );
    const engine = engineWith(fetcher, () => now, 20);

    await expect(engine.getTrack()).rejects.toThrow();
    now += 4_000;
    await expect(engine.getTrack()).rejects.toThrow();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("looks up duration and iTunes once per song", async () => {
    const fetcher = fakeFetcher();
    let now = 0;
    const engine = engineWith(fetcher, () => now);

    await engine.getTrack({ extras: ["itunes"] });
    now = 10_000;
    await engine.getTrack({ extras: ["itunes"] });

    expect(calls(fetcher, "user.getrecenttracks")).toBe(2);
    expect(calls(fetcher, "track.getInfo")).toBe(1);
    expect(calls(fetcher, "itunes.apple.com")).toBe(1);
  });

  it("remembers that Last.fm doesn't know a song", async () => {
    const fetcher = fakeFetcher({
      durationBody: { error: 6, message: "Track not found" },
      durationStatus: 404,
    });
    let now = 0;
    const engine = engineWith(fetcher, () => now);

    const first = await engine.getTrack();
    now = 10_000;
    await engine.getTrack();

    expect(first?.durationMs).toBeNull();
    expect(calls(fetcher, "track.getInfo")).toBe(1);
  });

  it("retries lookups that failed instead of caching the failure", async () => {
    const fetcher = fakeFetcher({ durationStatus: 503, itunesStatus: 503 });
    let now = 0;
    const engine = engineWith(fetcher, () => now);

    const first = await engine.getTrack({ extras: ["itunes"] });
    now = 10_000;
    await engine.getTrack({ extras: ["itunes"] });

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
