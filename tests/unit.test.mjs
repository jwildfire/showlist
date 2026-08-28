// Pure-logic tests. Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';

import { geohash, milesBetween, looksLikeZip } from '../js/geo.js';
import { resolveRange, toTicketmasterStamp, toBandsintownRange, toISODate } from '../js/dates.js';
import { normalizeGenre, ticketmasterNames } from '../js/genres.js';
import { chunk, normalizeName, pool } from '../js/util.js';
import { artistsFromShows, buildTracklist, toText } from '../js/playlist.js';

test('geohash matches known encodings', () => {
  assert.equal(geohash(30.2672, -97.7431, 7), '9v6kpvc');
  assert.equal(geohash(51.5074, -0.1278, 5), 'gcpvj');
});

test('milesBetween is a real great-circle distance', () => {
  const austin = { lat: 30.2672, lon: -97.7431 };
  const dallas = { lat: 32.7767, lon: -96.797 };
  const miles = milesBetween(austin, dallas);
  assert.ok(miles > 170 && miles < 190, `expected ~182, got ${miles}`);
  assert.equal(milesBetween(austin, austin), 0);
  assert.equal(milesBetween(austin, { lat: NaN, lon: NaN }), Infinity);
});

test('ZIP detection', () => {
  assert.ok(looksLikeZip('78701'));
  assert.ok(looksLikeZip(' 78701-1234 '));
  assert.ok(!looksLikeZip('Austin, TX'));
  assert.ok(!looksLikeZip('1234'));
});

test('day-count ranges start now and end at the end of the last day', () => {
  const now = new Date(2026, 7, 27, 14, 30); // Thu Aug 27 2026
  const { start, end } = resolveRange('7', { now });
  assert.equal(start.getTime(), now.getTime());
  assert.equal(toISODate(end), '2026-09-02');
  assert.equal(end.getHours(), 23);
});

test('weekend range covers Friday through Sunday', () => {
  const wednesday = new Date(2026, 7, 26, 9, 0);
  const week = resolveRange('weekend', { now: wednesday });
  assert.equal(toISODate(week.start), '2026-08-28');
  assert.equal(toISODate(week.end), '2026-08-30');

  // On a Sunday we're still in *this* weekend, not next week's.
  const sunday = new Date(2026, 7, 30, 11, 0);
  const current = resolveRange('weekend', { now: sunday });
  assert.equal(toISODate(current.start), '2026-08-28');
  assert.equal(toISODate(current.end), '2026-08-30');
});

test('custom ranges validate their order', () => {
  const now = new Date(2026, 7, 27);
  const range = resolveRange('custom', { now, customStart: '2026-09-01', customEnd: '2026-09-05' });
  assert.equal(toISODate(range.start), '2026-09-01');
  assert.equal(toISODate(range.end), '2026-09-05');
  assert.throws(
    () => resolveRange('custom', { now, customStart: '2026-09-05', customEnd: '2026-09-01' }),
    /ends before it starts/
  );
});

test('API date formats', () => {
  const start = new Date(Date.UTC(2026, 7, 27, 18, 30, 0));
  assert.equal(toTicketmasterStamp(start), '2026-08-27T18:30:00Z');
  assert.equal(
    toBandsintownRange(new Date(2026, 7, 27), new Date(2026, 8, 10)),
    '2026-08-27,2026-09-10'
  );
});

test('genre normalization folds source vocabularies onto our ids', () => {
  assert.equal(normalizeGenre('Hip-Hop/Rap'), 'hiphop');
  assert.equal(normalizeGenre('Dance/Electronic'), 'electronic');
  assert.equal(normalizeGenre('Indie Rock'), 'alternative');
  assert.equal(normalizeGenre('Rock'), 'rock');
  assert.equal(normalizeGenre('Undefined'), null);
  assert.equal(normalizeGenre(''), null);
  assert.deepEqual(ticketmasterNames(['rock', 'nope', 'jazz']), ['Rock', 'Jazz']);
});

test('artist names normalize for matching', () => {
  assert.equal(normalizeName('The Beatles'), 'beatles');
  assert.equal(normalizeName('Sigur Rós'), 'sigur ros');
  assert.equal(normalizeName('Earth, Wind & Fire'), 'earth wind and fire');
});

test('pool preserves order and respects its limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});

test('chunk splits evenly and keeps the remainder', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
});

const show = (id, artistNames, day) => ({
  id,
  start: new Date(2026, 7, day),
  venue: { name: `Venue ${id}`, lat: 30.2, lon: -97.7 },
  artists: artistNames.map((name) => ({ name })),
  genre: 'rock',
});

test('artistsFromShows dedupes across nights and orders by first date', () => {
  const artists = artistsFromShows([
    show('c', ['Big Thief'], 20),
    show('a', ['Khruangbin', 'Support Act'], 10),
    show('b', ['the khruangbin'], 15),
  ]);
  assert.deepEqual(
    artists.map((a) => a.name),
    ['Khruangbin', 'Support Act', 'Big Thief']
  );
  assert.equal(artists[0].shows.length, 2, 'both Khruangbin nights fold into one artist');
  assert.equal(artists[0].firstShow.id, 'a');
});

test('artistsFromShows honours the artist cap', () => {
  const many = Array.from({ length: 30 }, (_, i) => show(`s${i}`, [`Artist ${i}`], i + 1));
  assert.equal(artistsFromShows(many, { maxArtists: 5 }).length, 5);
});

test('buildTracklist flattens per-artist results and reports misses', () => {
  const artist = { name: 'Big Thief', firstShow: show('a', ['Big Thief'], 12) };
  const { tracks, missing } = buildTracklist([
    { artist, tracks: [{ id: '1', title: 'Vampire Empire' }, { id: '2', title: 'Simulation Swarm' }] },
    { artist: { name: 'Nobody', firstShow: show('b', ['Nobody'], 13) }, tracks: [], reason: 'not on Spotify' },
  ]);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].artistName, 'Big Thief');
  assert.equal(tracks[1].rank, 2);
  assert.deepEqual(missing, [{ name: 'Nobody', reason: 'not on Spotify' }]);
  assert.match(toText(tracks), /Big Thief — Vampire Empire — .* at Venue a/);
});

test('wallClock reads the time as written, whatever the viewer timezone', async () => {
  const { wallClock } = await import('../js/dates.js');
  const show = wallClock('2026-09-01T20:00:00-04:00');
  assert.equal(show.getHours(), 20, '8pm in Durham reads as 8pm anywhere');
  assert.equal(toISODate(show), '2026-09-01');

  // A date with no time falls back to a plausible door time.
  assert.equal(wallClock('2026-10-05').getHours(), 20);
  assert.equal(wallClock('nonsense'), null);
});

test('search links need no credentials and escape properly', async () => {
  const links = await import('../js/links.js');
  const track = { artistName: 'Black Country, New Road', title: 'Turbines / Pigs' };
  assert.equal(
    links.youtubeSearch(track),
    'https://www.youtube.com/results?search_query=Black%20Country%2C%20New%20Road%20Turbines%20%2F%20Pigs'
  );
  assert.match(links.spotifySearch(track), /^https:\/\/open\.spotify\.com\/search\//);
  assert.match(links.youtubeMusicSearch(track), /^https:\/\/music\.youtube\.com\/search\?q=/);
  assert.equal(links.youtubeQuickPlaylist([]), '');
  assert.equal(
    links.youtubeQuickPlaylist(['aaa', 'bbb']),
    'https://www.youtube.com/watch_videos?video_ids=aaa,bbb'
  );
  assert.match(links.toLinkList([track]), /^- Black Country, New Road — Turbines \/ Pigs · \[YouTube\]/);
});
