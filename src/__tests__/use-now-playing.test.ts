// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "../types.js";
import { useNowPlaying } from "../use-now-playing.js";

const TRACK: Track = {
  id: "Sade/No%20Ordinary%20Love",
  name: "No Ordinary Love",
  artist: "Sade",
  albumArtUrl: null,
  lastfmUrl: "https://www.last.fm/music/Sade/_/No%20Ordinary%20Love",
  nowPlaying: true,
  scrobbledAt: null,
  durationMs: 438_000,
};

const ITUNES_RESULT = {
  artistName: "Sade",
  trackName: "No Ordinary Love",
  artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/cover/100x100bb.jpg",
  previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
  trackViewUrl: "https://music.apple.com/us/album/no-ordinary-love/1",
  trackTimeMillis: 438_000,
};

const EMPTY_ITUNES = {
  artworkUrl: null,
  previewUrl: null,
  appleMusicUrl: null,
};

function respondWith(track: Track | null) {
  return Promise.resolve(Response.json({ track }));
}

function isItunes(input: unknown) {
  return String(input).startsWith("https://itunes.apple.com/");
}

// the browser lookup is remembered per song for the life of the module, so
// each test that relies on it gets a song of its own
function songNamed(name: string, track: Partial<Track> = {}): Track {
  return {
    ...TRACK,
    id: `Sade/${encodeURIComponent(name)}`,
    name,
    itunes: EMPTY_ITUNES,
    ...track,
  };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(() => respondWith(TRACK));
  vi.stubGlobal("fetch", fetchMock);
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useNowPlaying", () => {
  it("fetches the track and asks for the extras it was given", async () => {
    const filled: Track = {
      ...TRACK,
      itunes: {
        artworkUrl: "https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg",
        previewUrl: null,
        appleMusicUrl: null,
      },
    };
    fetchMock.mockImplementation(() => respondWith(filled));
    const { result } = renderHook(() =>
      useNowPlaying({ endpoint: "/api/np?user=me", extras: ["itunes"] }),
    );
    expect(result.current.status).toBe("loading");

    await flush();

    expect(result.current).toEqual({ status: "ready", track: filled });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/np?user=me&extras=itunes",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("looks the song up from the browser when the server's iTunes extra comes back empty", async () => {
    const song = songNamed("Cherish the Day");
    fetchMock.mockImplementation((input: unknown) =>
      isItunes(input)
        ? Promise.resolve(
            Response.json({
              results: [{ ...ITUNES_RESULT, trackName: song.name }],
            }),
          )
        : respondWith(song),
    );
    const { result } = renderHook(() => useNowPlaying({ extras: ["itunes"] }));
    await flush();

    expect(result.current.track?.itunes).toEqual({
      artworkUrl:
        "https://is1-ssl.mzstatic.com/image/thumb/cover/600x600bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
      appleMusicUrl: "https://music.apple.com/us/album/no-ordinary-love/1",
    });
    const itunesCalls = () =>
      fetchMock.mock.calls.filter(([input]) => isItunes(input)).length;
    expect(itunesCalls()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(itunesCalls()).toBe(1);
    expect(result.current.track?.itunes?.previewUrl).toBe(
      "https://audio-ssl.itunes.apple.com/preview.m4a",
    );
  });

  it("shows the track before the browser lookup answers", async () => {
    const song = songNamed("Kiss of Life");
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation((input: unknown) =>
      isItunes(input)
        ? new Promise<Response>((resolve) => (answer = resolve))
        : respondWith(song),
    );
    const { result } = renderHook(() => useNowPlaying({ extras: ["itunes"] }));
    await flush();

    expect(result.current).toEqual({ status: "ready", track: song });

    await act(async () =>
      answer(
        Response.json({
          results: [{ ...ITUNES_RESULT, trackName: song.name }],
        }),
      ),
    );
    expect(result.current.track?.itunes?.artworkUrl).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/cover/600x600bb.jpg",
    );
  });

  it("keeps everything on the server when the browser fallback is off", async () => {
    const song = songNamed("Paradise");
    fetchMock.mockImplementation(() => respondWith(song));
    const { result } = renderHook(() =>
      useNowPlaying({ extras: ["itunes"], browserFallback: false }),
    );
    await flush();

    expect(result.current).toEqual({ status: "ready", track: song });
    expect(fetchMock.mock.calls.some(([input]) => isItunes(input))).toBe(false);
  });

  it("takes the length from iTunes and keeps the song playing when only iTunes knows it", async () => {
    const song = songNamed("Smooth Operator", {
      nowPlaying: false,
      scrobbledAt: Date.now() - 60_000,
      durationMs: null,
    });
    fetchMock.mockImplementation((input: unknown) =>
      isItunes(input)
        ? Promise.resolve(
            Response.json({
              results: [
                {
                  ...ITUNES_RESULT,
                  trackName: song.name,
                  trackTimeMillis: 300_000,
                },
              ],
            }),
          )
        : respondWith(song),
    );
    const { result } = renderHook(() => useNowPlaying({ extras: ["itunes"] }));
    await flush();

    expect(result.current.track).toMatchObject({
      durationMs: 300_000,
      nowPlaying: true,
    });
  });

  it("polls every five seconds while a song plays and every ten otherwise", async () => {
    fetchMock
      .mockImplementationOnce(() => respondWith(TRACK))
      .mockImplementation(() => respondWith({ ...TRACK, nowPlaying: false }));
    renderHook(() => useNowPlaying());
    await flush();

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the last track when a poll fails", async () => {
    const { result } = renderHook(() => useNowPlaying());
    await flush();

    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 502 })),
    );
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(result.current).toEqual({ status: "error", track: TRACK });
  });

  it("doesn't start a second polling loop when the tab comes back mid-request", async () => {
    let resolveFirst: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveFirst = resolve)),
    );
    renderHook(() => useNowPlaying());

    setVisibility("hidden");
    setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveFirst(Response.json({ track: TRACK })));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling while the tab is hidden and checks right away when it returns", async () => {
    renderHook(() => useNowPlaying());
    await flush();

    setVisibility("hidden");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never shows the previous endpoint's track after switching", async () => {
    const { result, rerender } = renderHook(
      ({ endpoint }) => useNowPlaying({ endpoint }),
      { initialProps: { endpoint: "/api/a" } },
    );
    await flush();
    expect(result.current.track).toEqual(TRACK);

    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    rerender({ endpoint: "/api/b" });

    expect(result.current).toEqual({ status: "loading", track: null });
  });

  it("treats an answer without a track as no track", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json({ error: "something" })),
    );
    const { result } = renderHook(() => useNowPlaying());
    await flush();

    expect(result.current).toEqual({ status: "ready", track: null });
  });

  it("reports an error when the request itself fails", async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError("offline")),
    );
    const { result } = renderHook(() => useNowPlaying());
    await flush();

    expect(result.current).toEqual({ status: "error", track: null });
  });

  it("cancels the request in flight when it unmounts", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const { unmount } = renderHook(() => useNowPlaying());

    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
