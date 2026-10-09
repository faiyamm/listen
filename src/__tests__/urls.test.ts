import { expect, test } from "vitest";
import {
  isAllowedAppleMusicUrl,
  isAllowedArtworkUrl,
  isAllowedPreviewUrl,
  lastfmTrackUrl,
} from "../urls.js";

test("builds a safe Last.fm track URL", () => {
  expect(lastfmTrackUrl("Drake", "High Fives")).toBe(
    "https://www.last.fm/music/Drake/_/High%20Fives",
  );
});

test("allows only supported provider URLs", () => {
  expect(isAllowedArtworkUrl("https://is1-ssl.mzstatic.com/image.jpg")).toBe(
    true,
  );
  expect(isAllowedArtworkUrl("http://is1-ssl.mzstatic.com/image.jpg")).toBe(
    false,
  );
  expect(isAllowedPreviewUrl("https://audio-ssl.itunes.apple.com/a.m4a")).toBe(
    true,
  );
  expect(isAllowedAppleMusicUrl("https://music.apple.com/us/album/x/1")).toBe(
    true,
  );
  expect(isAllowedAppleMusicUrl("https://example.com/redirect")).toBe(false);
});
