import { useEffect, useState } from "react";

import type { Extra, NowPlayingResponse, Track } from "./types.js";

export type NowPlayingStatus = "loading" | "ready" | "error";

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 10_000;

export function useNowPlaying({
  endpoint = "/api/now-playing",
  extras = [],
}: {
  endpoint?: string;
  extras?: readonly Extra[];
} = {}) {
  const [track, setTrack] = useState<Track | null>(null);
  const [status, setStatus] = useState<NowPlayingStatus>("loading");
  const url = extras.length
    ? `${endpoint}?extras=${extras.join(",")}`
    : endpoint;

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function schedulePoll(track: Track | null) {
      pollTimer = setTimeout(
        poll,
        track?.nowPlaying ? ACTIVE_POLL_MS : IDLE_POLL_MS,
      );
    }

    async function poll() {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not fetch the current track.");

        const result = (await response.json()) as NowPlayingResponse;
        if (cancelled) return;

        setTrack(result.track);
        setStatus("ready");
        schedulePoll(result.track);
      } catch {
        if (cancelled) return;

        setStatus("error");
        schedulePoll(null);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (pollTimer) clearTimeout(pollTimer);
      void poll();
    }

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [url]);

  return { status, track };
}
