// The swept list: a JSON file of real, checked-in shows for one metro area,
// refreshed weekly (see sweep/README.md). No API key, no rate limit — the
// listings ship with the site.

import { milesBetween } from '../geo.js';
import { wallClock } from '../dates.js';

const DATA_URL = new URL('../../data/shows.json', import.meta.url);

export const meta = {
  id: 'local',
  label: 'Swept listings (no key)',
  needs: null,
  blurb: 'Shows gathered from public venue calendars each week and shipped with the site.',
};

let cached = null;

async function load() {
  if (cached) return cached;
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error('No swept listings found — data/shows.json is missing.');
  cached = await res.json();
  return cached;
}

/** The metro this file covers — used when you haven't set a location yourself. */
export async function area() {
  const data = await load();
  return data.area;
}

export async function findShows({ place, radius, start, end, genres }) {
  const data = await load();
  const origin = place || data.area;
  const wanted = new Set(genres || []);
  const limit = Number(radius) || data.area?.radiusMi || 60;

  const shows = data.shows
    .map(toShow)
    .filter((show) => show && show.start >= start && show.start <= end)
    .filter((show) => !wanted.size || wanted.has(show.genre))
    .filter((show) => milesBetween(origin, show.venue) <= limit)
    .sort((a, b) => a.start - b.start);

  return {
    shows,
    truncated: false,
    total: shows.length,
    generatedAt: data.generatedAt,
    area: data.area,
    coverage: data.coverage,
  };
}

function toShow(record) {
  const start = new Date(record.start);
  if (Number.isNaN(start.getTime())) return null;
  return {
    id: `local:${record.id}`,
    source: 'local',
    name: record.artists.join(' + '),
    start,
    displayDate: wallClock(record.start) || start,
    dateTBA: Boolean(record.timeUnknown),
    artists: record.artists.map((name) => ({ name, spotifyId: null })),
    venue: record.venue,
    url: record.url || '',
    image: '',
    genre: record.genre || null,
    note: record.note || '',
  };
}
