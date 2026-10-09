"use client";

import { useEffect, useState } from "react";

import type { Extra, NowPlayingResponse, Track } from "./types.js";

export type NowPlayingStatus = "loading" | "ready" | "error";

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 10_000;

function withExtras(endpoint: string, extras: readonly Extra[]) {
  if (!extras.length) return endpoint;
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}extras=${extras.join(",")}`;
}

export function useNowPlaying({
  endpoint = "/api/now-playing",
  extras = [],
}: {
  endpoint?: string;
  extras?: readonly Extra[];
} = {}) {
  const url = withExtras(endpoint, extras);
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

        const track = result.track ?? null;
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
  }, [url]);

  return state.url === url
    ? { status: state.status, track: state.track }
    : { status: "loading" as const, track: null };
}
