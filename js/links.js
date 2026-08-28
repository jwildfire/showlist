// Links that need no key, no login, and no API: a search URL per track on each
// service. Anyone can use these, forever.

const query = (track) => encodeURIComponent(`${track.artistName} ${track.title}`.trim());

export function youtubeSearch(track) {
  return `https://www.youtube.com/results?search_query=${query(track)}`;
}

export function youtubeMusicSearch(track) {
  return `https://music.youtube.com/search?q=${query(track)}`;
}

export function spotifySearch(track) {
  return `https://open.spotify.com/search/${query(track)}`;
}

/**
 * YouTube's anonymous playlist URL: up to 50 video ids become a temporary
 * playlist with no account involved. Undocumented, so treat it as a bonus.
 */
export function youtubeQuickPlaylist(videoIds) {
  const ids = videoIds.filter(Boolean).slice(0, 50);
  return ids.length ? `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}` : '';
}

/** A markdown list, one line per track, with a link out to each service. */
export function toLinkList(tracks) {
  return tracks
    .map(
      (track) =>
        `- ${track.artistName} — ${track.title} · [YouTube](${youtubeSearch(track)}) · [Spotify](${spotifySearch(track)})`
    )
    .join('\n');
}
