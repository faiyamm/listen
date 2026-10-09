# @actkool/listen

Show what you're listening to on Last.fm, with any design. listen fetches your latest track on the server, works out whether it is still playing, and hands your UI one clean JSON shape. It draws nothing, so the look is yours.

```bash
npm install @actkool/listen
```

## Before you start: your scrobbler

listen can only be as live as Last.fm. Last.fm knows what you're playing when your player sends it a "now playing" update, and not every scrobbler does that right away.

- **Spotify** sends it on its own once you connect your account to Last.fm.
- **Apple Music** needs a separate scrobbler. [FastScrobbler](https://github.com/kevinlim512/FastScrobbler) is open source and sends "now playing" as soon as a song starts. On Mac it is reliable. On iPhone it works best-effort, because iOS can suspend apps in the background.

Without a scrobbler like these, listen still works, but it shows the last song you played instead of the current one.

## Server

Create one engine and call it from any server route. It needs a [Last.fm API key](https://www.last.fm/api/account/create) and your username, and it keeps the key on the server.

```ts
// app/api/now-playing/route.ts
import { createNowPlayingEngine, parseExtras } from "@actkool/listen";

const engine = createNowPlayingEngine({
  apiKey: process.env.LASTFM_API_KEY!,
  username: process.env.LASTFM_USERNAME!,
});

export async function GET(request: Request) {
  const extras = parseExtras(new URL(request.url).searchParams.get("extras"));
  try {
    return Response.json({ track: await engine.getTrack({ extras }) });
  } catch {
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}
```

Create the engine once, outside the handler, so its caches survive between requests. Your latest track is cached for five seconds, counted from when Last.fm answers, and requests that arrive together share one call to Last.fm. Song lookups are cached for a day, so polling stays cheap.

`getTrack()` throws when Last.fm can't be reached, answers with an error, or doesn't answer within five seconds. Answer with an error status, as above, so your UI can tell "Last.fm is down" apart from "nothing scrobbled yet". A failure is reused for the same five seconds, so a Last.fm outage doesn't turn every poll into a new request.

The song length and the iTunes extra are looked up after that, each with its own five seconds. If one of them fails or runs out of time, its fields are `null` and the track still comes back, so a call can take up to about ten seconds. Pass `timeoutMs` to `createNowPlayingEngine` to change the limit for every request.

It runs anywhere with `fetch`: Node 20.19 or newer, Cloudflare Workers, Bun, Deno. The package is ESM; on Node, `require()` works from 20.19 and 22.12.

### Response

`getTrack()` returns a track, or `null` when the account has nothing scrobbled:

```json
{
  "id": "Artist/Track",
  "name": "Track",
  "artist": "Artist",
  "albumArtUrl": "https://lastfm.freetls.fastly.net/i/u/300x300/artwork.jpg",
  "lastfmUrl": "https://www.last.fm/music/Artist/_/Track",
  "nowPlaying": true,
  "scrobbledAt": 1788148800000,
  "durationMs": 214000
}
```

- `id` is the artist and the title, each URL-encoded and joined by `/`, so it is safe as a React key or a DOM id. Pass it through `CSS.escape()` before using it in a selector.
- `nowPlaying` is already resolved. It is true while Last.fm reports the track as playing, or while a scrobbled track is still within its length, which covers the gap before some scrobblers catch up.
- `scrobbledAt` is when the track started, in milliseconds, so you can show "played 3h ago". It is `null` while Last.fm reports the track as playing; when `nowPlaying` comes from the track length instead, it keeps its value.
- `durationMs` is `null` when no source knows the length.
- `albumArtUrl` is often `null`: Last.fm is missing artwork for many songs, and its grey placeholder star is left out. The iTunes extra below fills that gap.

### iTunes extra

Pass `["itunes"]` to also match the song on the iTunes Search API. It adds higher-resolution artwork, a 30-second preview, and an Apple Music link. Only a result by the same artist (or one of the credited artists) with the same title counts, ignoring suffixes like "(Live)" or "- Remastered", so a cover, a karaoke version or another song by the artist is never used. Any field can be `null` when iTunes has no match:

```json
{
  "...": "same fields as above",
  "itunes": {
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/.../600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/.../preview.m4a",
    "appleMusicUrl": "https://music.apple.com/us/album/..."
  }
}
```

It is opt-in, so a design that only needs the title and artist never waits on iTunes.

## React

`useNowPlaying` polls your route and renders nothing. It checks every five seconds while a song is playing and every ten seconds otherwise. It stops while the tab is hidden and checks right away when it comes back.

```tsx
import { useNowPlaying } from "@actkool/listen/react";

function NowPlaying() {
  const { status, track } = useNowPlaying({ extras: ["itunes"] });
  if (status === "loading" || !track) return null;

  return (
    <p>
      {track.nowPlaying ? "Listening to" : "Last played"} {track.name} by{" "}
      {track.artist}
    </p>
  );
}
```

`status` is `"loading"`, `"ready"`, or `"error"`. On an error, `track` keeps the last song it got, so you can keep showing it and fall back to an error message only when there is nothing to show. Pass `endpoint` if your route is not `/api/now-playing`.

The hook is a client module, so in the Next.js App Router use it from a component marked `"use client"`.

Not using React? Poll your route with `fetch`; the response is the same JSON.

## License

[MIT](LICENSE) © [faiyamm](https://github.com/faiyamm)
