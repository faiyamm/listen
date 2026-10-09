export const EXTRAS = ["itunes"] as const;

export type Extra = (typeof EXTRAS)[number];

export type ItunesExtras = {
  artworkUrl: string | null;
  previewUrl: string | null;
  appleMusicUrl: string | null;
};

export type Track = {
  id: string;
  name: string;
  artist: string;
  albumArtUrl: string | null;
  lastfmUrl: string;
  nowPlaying: boolean;
  scrobbledAt: number | null;
  durationMs: number | null;
  itunes?: ItunesExtras;
};

export type LastfmTrack = Pick<
  Track,
  "name" | "artist" | "albumArtUrl" | "nowPlaying" | "scrobbledAt"
>;

export type ItunesMatch = ItunesExtras & { durationMs: number | null };

export type NowPlayingResponse = { track: Track | null };
