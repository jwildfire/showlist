// Ticketmaster Discovery API — the "what's playing near me" source.
// Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/

import { geohash } from '../geo.js';
import { toTicketmasterStamp, wallClock } from '../dates.js';
import { ticketmasterNames, normalizeGenre } from '../genres.js';

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 100;
// Discovery refuses to page past the 1000th result, whatever the page size.
const MAX_RESULTS = 1000;

export const meta = {
  id: 'ticketmaster',
  label: 'Ticketmaster',
  needs: 'ticketmasterKey',
  blurb: 'Scans every listed show in your radius. Best coverage for clubs, halls and arenas.',
};

/**
 * @returns {Promise<{shows: Show[], truncated: boolean, total: number}>}
 */
export async function findShows({ apiKey, place, radius, start, end, genres, maxPages = 3, signal }) {
  if (!apiKey) throw new Error('Add your Ticketmaster API key in Setup first.');
  if (!place) throw new Error('Pick a location first.');

  const shows = [];
  const seen = new Set();
  let total = 0;
  let pages = 1;

  for (let page = 0; page < maxPages; page++) {
    if (page * PAGE_SIZE >= MAX_RESULTS) break;

    const url = new URL(ENDPOINT);
    const q = url.searchParams;
    q.set('apikey', apiKey);
    q.set('segmentName', 'Music');
    q.set('geoPoint', geohash(place.lat, place.lon));
    q.set('radius', String(Math.round(radius)));
    q.set('unit', 'miles');
    q.set('startDateTime', toTicketmasterStamp(start));
    q.set('endDateTime', toTicketmasterStamp(end));
    q.set('size', String(PAGE_SIZE));
    q.set('page', String(page));
    q.set('sort', 'date,asc');
    for (const name of ticketmasterNames(genres)) q.append('classificationName', name);

    const res = await fetch(url, { signal });
    if (!res.ok) throw await describeError(res);
    const body = await res.json();

    total = body.page?.totalElements ?? total;
    pages = body.page?.totalPages ?? pages;

    for (const event of body._embedded?.events || []) {
      const show = toShow(event);
      if (show && !seen.has(show.id)) {
        seen.add(show.id);
        shows.push(show);
      }
    }

    if (page + 1 >= pages) break;
  }

  return { shows, truncated: shows.length < total, total };
}

async function describeError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.fault?.faultstring || body.errors?.[0]?.detail || '';
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return new Error('Ticketmaster rejected that API key — check it in Setup.');
  if (res.status === 429)
    return new Error('Ticketmaster rate limit hit (5 requests/sec, 5000/day). Try again shortly.');
  return new Error(`Ticketmaster error ${res.status}${detail ? `: ${detail}` : ''}`);
}

function toShow(event) {
  const start = eventStart(event);
  if (!start) return null;

  const venue = event._embedded?.venues?.[0];
  const attractions = event._embedded?.attractions || [];
  const classification = event.classifications?.[0];

  const artists = attractions
    .filter((a) => a?.name)
    .map((a) => ({
      name: a.name,
      spotifyId: spotifyIdFrom(a),
      genre: normalizeGenre(
        a.classifications?.[0]?.genre?.name || a.classifications?.[0]?.subGenre?.name
      ),
    }));

  const local = event.dates?.start?.localDate
    ? wallClock(`${event.dates.start.localDate}T${event.dates.start.localTime || '20:00'}`)
    : null;

  return {
    id: `tm:${event.id}`,
    source: 'ticketmaster',
    name: event.name,
    start,
    displayDate: local || start,
    dateTBA: !event.dates?.start?.dateTime && !event.dates?.start?.localTime,
    artists: artists.length ? artists : [{ name: cleanEventName(event.name), spotifyId: null }],
    venue: {
      name: venue?.name || 'Venue TBA',
      city: venue?.city?.name || '',
      state: venue?.state?.stateCode || venue?.state?.name || '',
      lat: Number(venue?.location?.latitude),
      lon: Number(venue?.location?.longitude),
    },
    url: event.url || '',
    image: pickImage(event.images),
    genre:
      normalizeGenre(classification?.genre?.name) ||
      normalizeGenre(classification?.subGenre?.name) ||
      artists.find((a) => a.genre)?.genre ||
      null,
  };
}

function eventStart(event) {
  const d = event.dates?.start;
  if (!d) return null;
  if (d.dateTime) return new Date(d.dateTime);
  if (d.localDate) {
    const [y, m, day] = d.localDate.split('-').map(Number);
    const [hh, mm] = (d.localTime || '19:00:00').split(':').map(Number);
    return new Date(y, m - 1, day, hh || 19, mm || 0);
  }
  return null;
}

function spotifyIdFrom(attraction) {
  const url = attraction.externalLinks?.spotify?.[0]?.url || '';
  return url.match(/artist\/([A-Za-z0-9]+)/)?.[1] || null;
}

function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return '';
  const wide = images
    .filter((i) => i.width >= 300 && i.width <= 1200)
    .sort((a, b) => a.width - b.width)[0];
  return (wide || images[0]).url || '';
}

/** Event names are listing titles: "Foo Fighters Tickets" → "Foo Fighters". */
function cleanEventName(name) {
  return String(name || '')
    .replace(/\s*[-–—:|]\s*(tickets?|tour \d{4}|live in concert).*$/i, '')
    .replace(/\s+tickets?$/i, '')
    .trim();
}
