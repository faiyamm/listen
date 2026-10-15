"use client";

import { useEffect, useState } from "react";

import { findItunesMatch } from "./itunes.js";
import { isWithinPlayback } from "./playback.js";
import type { Extra, ItunesMatch, NowPlayingResponse, Track } from "./types.js";

export type NowPlayingStatus = "loading" | "ready" | "error";

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 10_000;
const LOOKUP_TIMEOUT_MS = 5_000;
const MAX_REMEMBERED_LOOKUPS = 50;

const NO_MATCH: ItunesMatch = {
  artworkUrl: null,
  previewUrl: null,
  appleMusicUrl: null,
  durationMs: null,
};

// one lookup per song for the life of the page, shared by every hook on it
const lookups = new Map<string, Promise<ItunesMatch>>();

function withExtras(endpoint: string, extras: readonly Extra[]) {
  if (!extras.length) return endpoint;
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}extras=${extras.join(",")}`;
}

function hasEmptyItunesExtra(track: Track) {
  const itunes = track.itunes;
  return (
    !itunes ||
    (itunes.artworkUrl === null &&
      itunes.previewUrl === null &&
      itunes.appleMusicUrl === null)
  );
}

function lookUpInBrowser(track: Track) {
  const existing = lookups.get(track.id);
  if (existing) return existing;

  const pending = findItunesMatch(track, {
    fetcher: fetch,
    timeoutMs: LOOKUP_TIMEOUT_MS,
  }).catch(() => NO_MATCH);
  lookups.set(track.id, pending);
  if (lookups.size > MAX_REMEMBERED_LOOKUPS) {
    const oldest = lookups.keys().next().value;
    if (oldest !== undefined) lookups.delete(oldest);
  }
  return pending;
}

function withMatch(track: Track, match: ItunesMatch): Track {
  const durationMs = track.durationMs ?? match.durationMs;
  return {
    ...track,
    durationMs,
    nowPlaying:
      track.nowPlaying ||
      isWithinPlayback(track.scrobbledAt, durationMs, Date.now()),
    itunes: {
      artworkUrl: track.itunes?.artworkUrl ?? match.artworkUrl,
      previewUrl: track.itunes?.previewUrl ?? match.previewUrl,
      appleMusicUrl: track.itunes?.appleMusicUrl ?? match.appleMusicUrl,
    },
  };
}

export function useNowPlaying({
  endpoint = "/api/now-playing",
  extras = [],
  browserFallback = true,
}: {
  endpoint?: string;
  extras?: readonly Extra[];
  browserFallback?: boolean;
} = {}) {
  const url = withExtras(endpoint, extras);
  const fillsItunesInBrowser = browserFallback && extras.includes("itunes");
  // tagged with its url, so switching endpoints never shows the old track
  const [state, setState] = useState<{
    url: string;
    status: NowPlayingStatus;
    track: Track | null;
  }>({ url, status: "loading", track: null });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;

    function schedule(nowPlaying: boolean) {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(poll, nowPlaying ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    }

    async function poll() {
      // one request at a time, so a response can't overwrite a newer one
      if (request) return;
      clearTimeout(timer);
      const controller = new AbortController();
      request = controller;
      let nowPlaying = false;

      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`${url} responded ${response.status}`);
        const result = (await response.json()) as NowPlayingResponse;
        if (controller.signal.aborted) return;

        let track = result.track ?? null;
        if (track && fillsItunesInBrowser && hasEmptyItunesExtra(track)) {
          // a shared outgoing ip, like cloudflare workers', is rate limited by
          // apple, so the server's lookup comes back empty. the visitor's own
          // browser isn't, so the song is looked up from here instead
          const firstLookup = !lookups.has(track.id);
          const pending = lookUpInBrowser(track);
          if (firstLookup) setState({ url, status: "ready", track });
          track = withMatch(track, await pending);
          if (controller.signal.aborted) return;
        }

        setState({ url, status: "ready", track });
        nowPlaying = track?.nowPlaying ?? false;
      } catch {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          url,
          status: "error",
          track: previous.url === url ? previous.track : null,
        }));
      } finally {
        if (request === controller) request = undefined;
      }

      schedule(nowPlaying);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") clearTimeout(timer);
      else void poll();
    }

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [url, fillsItunesInBrowser]);

  return state.url === url
    ? { status: state.status, track: state.track }
    : { status: "loading" as const, track: null };
}
