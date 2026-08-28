// Apple's iTunes Search API: public, keyless, CORS-enabled, no login. It gives
// us real track titles (and 30-second previews) for an artist, which is what
// makes the whole site work for someone who hasn't connected anything.
//
// Docs: https://performance-partners.apple.com/search-api

import { normalizeName, pool } from '../util.js';

const ENDPOINT = 'https://itunes.apple.com/search';

export const service = { id: 'itunes', label: 'Apple Music catalogue' };

/** Always available — there's nothing to connect. */
export function isConnected() {
  return true;
}

export async function findTracks(artist, { perArtist = 3, country = 'US' } = {}) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('term', artist);
  url.searchParams.set('attribute', 'artistTerm'); // match the artist, not lyrics
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', String(Math.max(perArtist * 5, 15)));
  url.searchParams.set('country', country);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Track lookup failed (${res.status})`);
  const body = await res.json();

  const target = normalizeName(artist);
  const seen = new Set();
  const tracks = [];

  for (const row of body.results || []) {
    if (row.kind !== 'song' || !row.trackName) continue;
    // Keep the artist we asked about, not whoever they guested for.
    if (normalizeName(row.artistName) !== target) continue;
    const key = normalizeName(row.trackName);
    if (seen.has(key)) continue; // the same song across three reissues
    seen.add(key);
    tracks.push({
      id: `itunes:${row.trackId}`,
      title: row.trackName,
      artistName: row.artistName,
      album: row.collectionName || '',
      url: row.trackViewUrl || '',
      preview: row.previewUrl || '',
      art: row.artworkUrl100 || '',
    });
    if (tracks.length >= perArtist) break;
  }
  return tracks;
}

export async function resolveTracks(artists, { perArtist = 3, onProgress } = {}) {
  let done = 0;
  // Apple throttles around 20 calls/minute per IP, so keep two in flight.
  return pool(artists, 2, async (artist) => {
    try {
      const tracks = await findTracks(artist.name, { perArtist });
      return { artist, tracks, reason: tracks.length ? null : 'no songs in the catalogue' };
    } catch (err) {
      return { artist, tracks: [], reason: err.message };
    } finally {
      onProgress?.(++done, artists.length);
    }
  });
}
