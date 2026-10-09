# @actkool/listen

Show what you're listening to on Last.fm, with any design. listen fetches your latest track on the server, works out whether it is still playing, and hands your UI one clean JSON shape. It draws nothing, so the look is yours.

```bash
pnpm add @actkool/listen
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
  return Response.json({ track: await engine.getTrack(extras) });
}
```

Create the engine once, outside the handler, so its caches survive between requests. Responses are cached for five seconds, and song lookups for a day, so polling stays cheap. Failed lookups are not cached and get retried.

It runs anywhere with `fetch`: Node 20 or newer, Cloudflare Workers, Bun, Deno.

### Response

`getTrack()` returns a track, or `null` when the account has nothing scrobbled or Last.fm can't be reached:

```json
{
  "id": "Artist\u0000Track",
  "name": "Track",
  "artist": "Artist",
  "albumArtUrl": "https://lastfm.freetls.fastly.net/i/u/300x300/artwork.jpg",
  "lastfmUrl": "https://www.last.fm/music/Artist/_/Track",
  "nowPlaying": true,
  "scrobbledAt": 1788148800000,
  "durationMs": 214000
}
```

- `nowPlaying` is already resolved. It is true while Last.fm reports the track as playing, or while a scrobbled track is still within its length, which covers the gap before some scrobblers catch up.
- `scrobbledAt` is when the track was scrobbled, in milliseconds, so you can show "played 3 h ago". It is `null` while the track is playing.
- `durationMs` is `null` when no source knows the length.
- `albumArtUrl` is often `null`: Last.fm is missing artwork for many songs. The iTunes extra below fills that gap.

### iTunes extra

Pass `["itunes"]` to also match the song on the iTunes Search API. It adds higher-resolution artwork, a 30-second preview, and an Apple Music link. Any field can be `null` when iTunes has no match:

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

`useNowPlaying` polls your route and renders nothing. It checks every five seconds while a song is playing, every ten seconds otherwise, and right away when the tab comes back into view.

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

`status` is `"loading"`, `"ready"`, or `"error"`. Pass `endpoint` if your route is not `/api/now-playing`.

Not using React? Poll your route with `fetch`; the response is the same JSON.

## License

[MIT](LICENSE) © [faiyamm](https://github.com/faiyamm)
