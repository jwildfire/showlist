#!/usr/bin/env node
/**
 * Checks data/shows.json before it ships: every show needs a real artist, a
 * parseable date, a located venue inside the covered radius, and a genre the
 * app knows about. Run it after every sweep — CI runs it too.
 *
 *   node sweep/validate.mjs
 */
import { readFileSync } from 'node:fs';
import { GENRES } from '../js/genres.js';
import { milesBetween } from '../js/geo.js';

const FILE = new URL('../data/shows.json', import.meta.url);
const GENRE_IDS = new Set(GENRES.map((g) => g.id));

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const data = JSON.parse(readFileSync(FILE, 'utf8'));

if (Number.isNaN(Date.parse(data.generatedAt || ''))) fail('generatedAt is missing or unparseable');
const area = data.area || {};
for (const key of ['label', 'lat', 'lon', 'radiusMi']) {
  if (area[key] === undefined) fail(`area.${key} is missing`);
}
if (!Array.isArray(data.shows) || !data.shows.length) fail('shows is empty');

const seen = new Set();
const now = new Date();
let future = 0;

for (const [i, show] of (data.shows || []).entries()) {
  const at = `shows[${i}]${show?.id ? ` (${show.id})` : ''}`;

  if (!show.id) fail(`${at}: no id`);
  else if (seen.has(show.id)) fail(`${at}: duplicate id`);
  else seen.add(show.id);

  if (!Array.isArray(show.artists) || !show.artists.length) fail(`${at}: no artists`);
  else if (show.artists.some((name) => typeof name !== 'string' || !name.trim()))
    fail(`${at}: blank artist name`);

  const start = new Date(show.start);
  if (Number.isNaN(start.getTime())) fail(`${at}: unparseable start "${show.start}"`);
  else if (start < now) warn(`${at}: already happened (${show.start}) — prune it on the next sweep`);
  else future++;

  if (show.genre && !GENRE_IDS.has(show.genre)) fail(`${at}: unknown genre "${show.genre}"`);

  const venue = show.venue || {};
  if (!venue.name) fail(`${at}: no venue name`);
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) {
    fail(`${at}: venue has no usable coordinates`);
  } else if (Number.isFinite(area.lat)) {
    const miles = milesBetween({ lat: area.lat, lon: area.lon }, venue);
    if (miles > area.radiusMi)
      fail(`${at}: ${venue.name} is ${miles.toFixed(0)} mi out, past the ${area.radiusMi} mi radius`);
  }

  if (show.url && !/^https?:\/\//.test(show.url)) fail(`${at}: url isn't a link`);
}

if (!future && (data.shows || []).length) fail('every show in the file is in the past');

for (const message of warnings) console.warn(`warn: ${message}`);
for (const message of errors) console.error(`fail: ${message}`);

console.log(
  errors.length
    ? `\n${errors.length} problem(s) in data/shows.json`
    : `data/shows.json OK — ${data.shows.length} shows (${future} upcoming) across ${data.venues?.length ?? '?'} venues, swept ${data.generatedAt}`
);
process.exit(errors.length ? 1 : 0);
