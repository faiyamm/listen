const artworkHosts = new Set([
  "lastfm.freetls.fastly.net",
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
]);

function isHttpsUrlOn(url: string, hosts: Set<string>) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && hosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function lastfmTrackUrl(artist: string, name: string) {
  return `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(name)}`;
}

export function isAllowedArtworkUrl(url: string) {
  return isHttpsUrlOn(url, artworkHosts);
}

export function isAllowedPreviewUrl(url: string) {
  return isHttpsUrlOn(url, new Set(["audio-ssl.itunes.apple.com"]));
}

export function isAllowedAppleMusicUrl(url: string) {
  return isHttpsUrlOn(url, new Set(["music.apple.com", "itunes.apple.com"]));
}
