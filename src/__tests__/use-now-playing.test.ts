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

function respondWith(track: Track | null) {
  return Promise.resolve(Response.json({ track }));
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
    const { result } = renderHook(() =>
      useNowPlaying({ endpoint: "/api/np?user=me", extras: ["itunes"] }),
    );
    expect(result.current.status).toBe("loading");

    await flush();

    expect(result.current).toEqual({ status: "ready", track: TRACK });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/np?user=me&extras=itunes",
      expect.objectContaining({ cache: "no-store" }),
    );
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
