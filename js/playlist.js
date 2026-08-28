// Shows in, tracklist out.

import { formatDay, formatRangeShort } from './dates.js';
import { normalizeName } from './util.js';

/**
 * Collapse a list of shows into the artists playing them, soonest first.
 * One entry per artist even if they're playing three nights.
 */
export function artistsFromShows(shows, { maxArtists = 40 } = {}) {
  const byArtist = new Map();

  for (const show of [...shows].sort((a, b) => a.start - b.start)) {
    for (const artist of show.artists || []) {
      if (!artist?.name) continue;
      const key = normalizeName(artist.name);
      if (!key) continue;
      const existing = byArtist.get(key);
      if (existing) {
        existing.shows.push(show);
        existing.spotifyId = existing.spotifyId || artist.spotifyId || null;
      } else {
        byArtist.set(key, {
          key,
          name: artist.name,
          spotifyId: artist.spotifyId || null,
          genre: artist.genre || show.genre || null,
          shows: [show],
        });
      }
    }
  }

  return [...byArtist.values()]
    .map((a) => ({ ...a, firstShow: a.shows[0] }))
    .sort((a, b) => a.firstShow.start - b.firstShow.start)
    .slice(0, maxArtists);
}

/**
 * Flatten per-artist track results into one ordered playlist: artists in
 * show order, each artist's tracks in the order the service ranked them.
 */
export function buildTracklist(results) {
  const tracks = [];
  const missing = [];

  for (const result of results) {
    if (!result) continue;
    const { artist, tracks: found, reason } = result;
    if (!found?.length) {
      missing.push({ name: artist.name, reason: reason || 'no tracks found' });
      continue;
    }
    found.forEach((track, i) => {
      tracks.push({
        ...track,
        artistName: track.artistName || artist.name,
        rank: i + 1,
        show: artist.firstShow,
      });
    });
  }

  return { tracks, missing };
}

export function playlistTitle({ place, start, end }) {
  const where = place?.label ? place.label.split(',')[0] : 'nearby';
  return `Shows near ${where} · ${formatRangeShort(start, end)}`;
}

export function playlistDescription({ tracks, artists, place, start, end, source }) {
  const artistCount = artists?.length ?? new Set(tracks.map((t) => t.artistName)).size;
  return [
    `${artistCount} artists playing near ${place?.label || 'you'} between ${formatRangeShort(start, end)}.`,
    `Built with Showlist from ${source === 'ticketmaster' ? 'Ticketmaster' : source === 'bandsintown' ? 'Bandsintown' : 'demo'} listings.`,
  ].join(' ');
}

/** A plain-text tracklist, for pasting anywhere that isn't a music service. */
export function toText(tracks) {
  return tracks
    .map((t) => {
      const show = t.show;
      const when = show
        ? ` — ${formatDay(show.displayDate || show.start)} at ${show.venue?.name || 'TBA'}`
        : '';
      return `${t.artistName} — ${t.title}${when}`;
    })
    .join('\n');
}

export function toJson({ tracks, shows, place, start, end, source }) {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      place,
      window: { start: start.toISOString(), end: end.toISOString() },
      source,
      shows: (shows || []).map((s) => ({
        name: s.name,
        start: s.start.toISOString(),
        venue: s.venue,
        artists: s.artists.map((a) => a.name),
        genre: s.genre,
        url: s.url,
      })),
      tracks: tracks.map((t) => ({
        artist: t.artistName,
        title: t.title,
        url: t.url || null,
        uri: t.uri || null,
        videoId: t.videoId || null,
      })),
    },
    null,
    2
  );
}
