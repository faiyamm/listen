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
  const [track, setTrack] = useState<Track | null>(null);
  const [status, setStatus] = useState<NowPlayingStatus>("loading");
  const url = withExtras(endpoint, extras);

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

        setTrack(result.track);
        setStatus("ready");
        nowPlaying = result.track?.nowPlaying ?? false;
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
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

  return { status, track };
}
