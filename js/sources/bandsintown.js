// Bandsintown — a watchlist source. Its public API answers "where is this
// artist playing?", not "who is playing near me", so we ask it about a list of
// artists (typed in, or imported from your Spotify listening) and keep the
// dates that land inside your radius and date window.
// Docs: https://artists.bandsintown.com/support/api-installation

import { milesBetween } from '../geo.js';
import { toBandsintownRange } from '../dates.js';
import { pool, normalizeName } from '../util.js';

const ENDPOINT = 'https://rest.bandsintown.com/artists';

export const meta = {
  id: 'bandsintown',
  label: 'Bandsintown watchlist',
  needs: 'bandsintownAppId',
  blurb:
    'Checks a list of artists you care about for dates near you — including small rooms Ticketmaster never lists.',
};

export async function findShows({ appId, artists, place, radius, start, end, signal }) {
  if (!appId) throw new Error('Add a Bandsintown app id in Setup first.');
  if (!place) throw new Error('Pick a location first.');
  if (!artists?.length)
    throw new Error('Your watchlist is empty — add artists, or import them from Spotify.');

  const misses = [];
  const range = toBandsintownRange(start, end);

  const perArtist = await pool(artists, 4, async (artist) => {
    try {
      const events = await fetchArtistEvents(artist, appId, range, signal);
      if (!events.length) misses.push(artist);
      return events
        .map((event) => toShow(event, artist))
        .filter((show) => show && milesBetween(place, show.venue) <= radius);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      misses.push(artist);
      return [];
    }
  });

  const shows = perArtist.flat().sort((a, b) => a.start - b.start);
  return { shows, misses, total: shows.length, truncated: false };
}

async function fetchArtistEvents(artist, appId, range, signal) {
  // Bandsintown wants slashes and question marks double-encoded in the path.
  const path = encodeURIComponent(artist).replace(/%2F/gi, '%252F').replace(/%3F/gi, '%253F');
  const url = new URL(`${ENDPOINT}/${path}/events`);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('date', range);

  const res = await fetch(url, { signal });
  if (res.status === 404) return [];
  if (!res.ok) {
    if (res.status === 403 || res.status === 401)
      throw new Error('Bandsintown rejected that app id — check it in Setup.');
    throw new Error(`Bandsintown error ${res.status}`);
  }
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

function toShow(event, queriedArtist) {
  if (!event?.datetime) return null;
  const venue = event.venue || {};
  const lineup = Array.isArray(event.lineup) && event.lineup.length ? event.lineup : [queriedArtist];
  const headliner = lineup.find((n) => normalizeName(n) === normalizeName(queriedArtist)) || lineup[0];

  return {
    id: `bit:${event.id}`,
    source: 'bandsintown',
    name: event.title || `${headliner} at ${venue.name || 'TBA'}`,
    start: new Date(event.datetime),
    dateTBA: false,
    artists: lineup.filter(Boolean).map((name) => ({ name, spotifyId: null })),
    venue: {
      name: venue.name || 'Venue TBA',
      city: venue.city || '',
      state: venue.region || venue.country || '',
      lat: Number(venue.latitude),
      lon: Number(venue.longitude),
    },
    url: event.url || event.offers?.[0]?.url || '',
    image: '',
    genre: null,
  };
}
