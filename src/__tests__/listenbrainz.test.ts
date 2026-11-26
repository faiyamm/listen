import { describe, expect, it, vi } from "vitest";

import pkg from "../../package.json" with { type: "json" };

import { createNowPlayingEngine } from "../music.js";

const RELEASE = "3a329dbe-b239-4e00-9d31-de19c8d6f7a1";

const PLAYING_BBW = {
  payload: {
    count: 1,
    playing_now: true,
    listens: [
      {
        playing_now: true,
        track_metadata: {
          artist_name: "Drake",
          track_name: "BBW",
          additional_info: { duration_ms: 240_000 },
        },
      },
    ],
  },
};

const LISTENED_BBW = {
  payload: {
    count: 1,
    listens: [
      {
        listened_at: 1_000,
        track_metadata: {
          artist_name: "Drake",
          track_name: "BBW",
          additional_info: { duration_ms: 240_000 },
          mbid_mapping: { caa_id: 11191548594, caa_release_mbid: RELEASE },
        },
      },
    ],
  },
};

const NOTHING = { payload: { count: 0, listens: [] } };

function fakeListenbrainz({
  playingNow = NOTHING as unknown,
  listens = LISTENED_BBW as unknown,
  status = 200,
  listensStatus = undefined as number | undefined,
  itunesDurationMs = undefined as number | undefined,
} = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "itunes.apple.com") {
      return Response.json({
        results: [
          {
            artistName: "Drake",
            trackName: "BBW",
            trackTimeMillis: itunesDurationMs,
          },
        ],
      });
    }
    if (url.pathname.endsWith("/playing-now")) {
      return Response.json(playingNow, { status });
    }
    return Response.json(listens, { status: listensStatus ?? status });
  });
}

function engineWith(fetcher: ReturnType<typeof fakeListenbrainz>, now = 0) {
  return createNowPlayingEngine({
    service: "listenbrainz",
    username: "listener",
    fetcher,
    now: () => now,
  });
}

describe("createNowPlayingEngine with ListenBrainz", () => {
  it("returns the song playing now with the cover art of its listen", async () => {
    const fetcher = fakeListenbrainz({ playingNow: PLAYING_BBW });

    const track = await engineWith(fetcher).getTrack();

    expect(track).toEqual({
      id: "Drake/BBW",
      name: "BBW",
      artist: "Drake",
      albumArtUrl: `https://coverartarchive.org/release/${RELEASE}/11191548594-500.jpg`,
      lastfmUrl: "https://www.last.fm/music/Drake/_/BBW",
      nowPlaying: true,
      scrobbledAt: null,
      durationMs: 240_000,
    });
  });

  it("leaves the art empty when the latest listen is another song", async () => {
    const fetcher = fakeListenbrainz({
      playingNow: {
        payload: {
          listens: [
            {
              track_metadata: {
                artist_name: "Drake",
                track_name: "Fair Trade",
              },
            },
          ],
        },
      },
    });

    const track = await engineWith(fetcher).getTrack();

    expect(track).toMatchObject({
      name: "Fair Trade",
      albumArtUrl: null,
      nowPlaying: true,
      durationMs: null,
    });
  });

  it("shows the last listen as playing until its length runs out", async () => {
    const fetcher = fakeListenbrainz();

    const during = await engineWith(fetcher, 1_060_000).getTrack();
    const after = await engineWith(fetcher, 1_300_000).getTrack();

    expect(during).toMatchObject({
      name: "BBW",
      nowPlaying: true,
      scrobbledAt: 1_000_000,
    });
    expect(after).toMatchObject({ nowPlaying: false, scrobbledAt: 1_000_000 });
  });

  it("reads a length given in seconds", async () => {
    const fetcher = fakeListenbrainz({
      listens: {
        payload: {
          listens: [
            {
              listened_at: 1_000,
              track_metadata: {
                artist_name: "Drake",
                track_name: "BBW",
                additional_info: { duration: 200 },
              },
            },
          ],
        },
      },
    });

    const track = await engineWith(fetcher).getTrack();

    expect(track?.durationMs).toBe(200_000);
  });

  it("takes the length from iTunes when ListenBrainz has none", async () => {
    const fetcher = fakeListenbrainz({
      itunesDurationMs: 210_000,
      listens: {
        payload: {
          listens: [
            {
              listened_at: 1_000,
              track_metadata: { artist_name: "Drake", track_name: "BBW" },
            },
          ],
        },
      },
    });

    const withoutItunes = await engineWith(fetcher).getTrack();
    const withItunes = await engineWith(fetcher).getTrack({
      extras: ["itunes"],
    });

    expect(withoutItunes?.durationMs).toBeNull();
    expect(withItunes?.durationMs).toBe(210_000);
  });

  it("skips cover art whose release id is not an MBID", async () => {
    const fetcher = fakeListenbrainz({
      listens: {
        payload: {
          listens: [
            {
              listened_at: 1_000,
              track_metadata: {
                artist_name: "Drake",
                track_name: "BBW",
                mbid_mapping: { caa_id: 1, caa_release_mbid: "../../evil" },
              },
            },
          ],
        },
      },
    });

    const track = await engineWith(fetcher).getTrack();

    expect(track?.albumArtUrl).toBeNull();
  });

  it("returns null when the account has no listens", async () => {
    const fetcher = fakeListenbrainz({ listens: NOTHING });

    await expect(engineWith(fetcher).getTrack()).resolves.toBeNull();
  });

  it("throws when ListenBrainz refuses, so the route can report an error", async () => {
    const missing = fakeListenbrainz({ status: 404 });
    const limited = fakeListenbrainz({ status: 429 });

    await expect(engineWith(missing).getTrack()).rejects.toThrow("404");
    await expect(engineWith(limited).getTrack()).rejects.toThrow("429");
  });

  it("throws when only the listens request fails", async () => {
    const fetcher = fakeListenbrainz({
      playingNow: PLAYING_BBW,
      listensStatus: 503,
    });

    await expect(engineWith(fetcher).getTrack()).rejects.toThrow("503");
  });

  it("takes the length of the song playing now from its listen", async () => {
    const fetcher = fakeListenbrainz({
      playingNow: {
        payload: {
          listens: [
            { track_metadata: { artist_name: "Drake", track_name: "BBW" } },
          ],
        },
      },
    });

    const track = await engineWith(fetcher).getTrack();

    expect(track?.durationMs).toBe(240_000);
  });

  it("identifies itself with the package version on every request", async () => {
    const fetcher = fakeListenbrainz();

    await engineWith(fetcher).getTrack();

    const agents = fetcher.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("User-Agent"),
    );
    expect(agents).toEqual([
      `actkool-listen/${pkg.version} ( https://github.com/faiyamm/listen )`,
      `actkool-listen/${pkg.version} ( https://github.com/faiyamm/listen )`,
    ]);
  });

  it("needs a ListenBrainz username", () => {
    expect(() =>
      createNowPlayingEngine({ service: "listenbrainz", username: " " }),
    ).toThrow("needs a ListenBrainz username");
    expect(() =>
      createNowPlayingEngine({ service: "listenbrainz", username: ".." }),
    ).toThrow("needs a ListenBrainz username");
    expect(() =>
      createNowPlayingEngine({ service: "listenbrainz", username: "." }),
    ).toThrow("needs a ListenBrainz username");
  });

  it("refuses a service it doesn't know", () => {
    expect(() =>
      createNowPlayingEngine({
        service: "spotify" as "listenbrainz",
        username: "listener",
      }),
    ).toThrow('service must be "lastfm" or "listenbrainz", got spotify');
  });
});
