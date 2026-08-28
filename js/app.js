// Wiring: controls → source → artists → tracks → playlist.

import * as store from './state.js';
import * as spotify from './music/spotify.js';
import * as youtube from './music/youtube.js';
import * as itunes from './music/itunes.js';
import * as local from './sources/local.js';
import * as ticketmaster from './sources/ticketmaster.js';
import * as bandsintown from './sources/bandsintown.js';
import * as demo from './sources/demo.js';
import { GENRES } from './genres.js';
import { formatDay, RANGE_PRESETS, resolveRange, toISODate } from './dates.js';
import { geocode, locateMe } from './geo.js';
import {
  artistsFromShows,
  buildTracklist,
  playlistDescription,
  playlistTitle,
  toJson,
  toText,
} from './playlist.js';
import { renderGenreChips, renderLinks, renderShows, renderTracks } from './ui.js';
import { toLinkList } from './links.js';

const SOURCES = { local, ticketmaster, bandsintown, demo };
const el = (id) => document.getElementById(id);

/** Everything about the current search that isn't persisted. */
const view = {
  shows: [],
  place: null,
  spotifyWritesBlocked: false,
  excluded: new Set(),
  artists: [],
  tracks: [],
  missing: [],
  range: null,
  provider: null, // which service produced the tracks
  busy: false,
};

init();

function init() {
  buildStaticControls();
  restoreControls();
  wireEvents();
  applyCompact(store.getControls().compact);
  refreshServiceChips();
  finishSpotifyRedirect();
  el('redirectUri').value = store.redirectUri();
  syncSourcePanels();
}

/* ---------- setup of the static bits ---------- */

function buildStaticControls() {
  el('when').replaceChildren(
    ...RANGE_PRESETS.map((preset) => new Option(preset.label, preset.id))
  );
  el('source').replaceChildren(
    ...Object.values(SOURCES).map((source) => new Option(source.meta.label, source.meta.id))
  );
  labelPreloadedSource();
}

/** The preloaded option is named after whatever metro the data file covers. */
async function labelPreloadedSource() {
  try {
    const area = await local.area();
    const option = [...el('source').options].find((o) => o.value === 'local');
    if (option && area?.label) option.textContent = `${area.label} (preloaded)`;
  } catch {
    /* no data file yet — the generic label is fine */
  }
}

function restoreControls() {
  const controls = store.getControls();
  el('location').value = controls.location || '';
  el('radius').value = String(controls.radius);
  el('when').value = controls.range;
  el('source').value = controls.source;
  el('customStart').value = controls.customStart;
  el('customEnd').value = controls.customEnd;
  el('customRange').hidden = controls.range !== 'custom';

  const stored = store.getStoredCredentials();
  el('tmKey').value = stored.ticketmasterKey;
  el('bitAppId').value = stored.bandsintownAppId;
  el('spotifyClientId').value = stored.spotifyClientId;
  el('googleClientId').value = stored.googleClientId;
  for (const [field, id] of [
    ['spotifyClientId', 'spotifyClientId'],
    ['googleClientId', 'googleClientId'],
  ]) {
    if (store.hasBuiltIn(field) && !stored[field]) {
      el(id).placeholder = "this site has one built in — leave blank to use it";
    }
  }

  el('watchlist').value = store.getWatchlist().join('\n');
  updateWatchlistCount();

  const place = store.getPlace();
  if (place) el('placeHint').textContent = `Searching around ${place.label}`;

  drawGenres();
}

function drawGenres() {
  const selected = new Set(store.getControls().genres);
  renderGenreChips(el('genres'), selected, (id) => {
    const next = new Set(store.getControls().genres);
    if (id === null) next.clear();
    else if (next.has(id)) next.delete(id);
    else next.add(id);
    store.setControls({ genres: [...next] });
    drawGenres();
  });
}

function wireEvents() {
  el('when').addEventListener('change', () => {
    const range = el('when').value;
    el('customRange').hidden = range !== 'custom';
    if (range === 'custom' && !el('customStart').value) {
      const today = new Date();
      const later = new Date();
      later.setDate(later.getDate() + 14);
      el('customStart').value = toISODate(today);
      el('customEnd').value = toISODate(later);
    }
    store.setControls({ range });
  });
  el('radius').addEventListener('change', () => store.setControls({ radius: Number(el('radius').value) }));
  el('source').addEventListener('change', () => {
    store.setControls({ source: el('source').value });
    syncSourcePanels();
  });
  for (const id of ['customStart', 'customEnd']) {
    el(id).addEventListener('change', () =>
      store.setControls({ customStart: el('customStart').value, customEnd: el('customEnd').value })
    );
  }
  el('location').addEventListener('change', () => store.setControls({ location: el('location').value }));

  el('locate').addEventListener('click', () => guard(useMyLocation));
  el('find').addEventListener('click', () => guard(runFind));
  el('auto').addEventListener('click', () => guard(runAuto));
  el('build').addEventListener('click', () => guard(runBuild));
  el('saveSpotify').addEventListener('click', () => guard(saveToSpotify));
  el('saveYouTube').addEventListener('click', () => guard(saveToYouTube));
  el('copyList').addEventListener('click', () => guard(copyList));
  el('copyLinks').addEventListener('click', () => guard(copyLinks));
  el('downloadJson').addEventListener('click', downloadJson);

  el('selectAll').addEventListener('click', () => setAllShows(true));
  el('selectNone').addEventListener('click', () => setAllShows(false));

  el('watchlist').addEventListener('change', () => {
    store.setWatchlist(el('watchlist').value.split('\n'));
    updateWatchlistCount();
  });
  el('importSpotify').addEventListener('click', () => guard(importWatchlist));

  el('compactToggle').addEventListener('click', () => {
    const compact = !store.getControls().compact;
    store.setControls({ compact });
    applyCompact(compact);
  });
  el('setupBtn').addEventListener('click', () => el('setupDialog').showModal());
  el('saveSetup').addEventListener('click', saveSetup);
  el('copyRedirect').addEventListener('click', () => guard(copyRedirect));
  el('connectSpotify').addEventListener('click', () => guard(connectSpotify));
  el('connectYouTube').addEventListener('click', () => guard(connectYouTube));
  el('clearData').addEventListener('click', clearData);
  el('spotifyChip').addEventListener('click', () => guard(toggleSpotify));
  el('youtubeChip').addEventListener('click', () => guard(toggleYouTube));

  el('errorClose').addEventListener('click', () => (el('error').hidden = true));
}

/** Compact mode is a body class — all the density lives in CSS. */
function applyCompact(compact) {
  document.body.classList.toggle('compact', compact);
  const toggle = el('compactToggle');
  toggle.classList.toggle('on', compact);
  toggle.setAttribute('aria-pressed', String(compact));
  toggle.title = compact ? 'Compact rows — click to loosen' : 'Roomy rows — click to compact';
}

function syncSourcePanels() {
  const source = store.getControls().source;
  el('watchlistPanel').hidden = source !== 'bandsintown';
  el('sourceHint').textContent = SOURCES[source]?.meta.blurb || '';
}

/* ---------- status plumbing ---------- */

function setStatus(text, busy = false) {
  const node = el('status');
  node.textContent = text;
  node.classList.toggle('busy', busy);
}

function showError(err) {
  const message = err?.message || String(err);
  el('errorText').textContent = message;
  el('error').hidden = false;
  setStatus('');
  console.error(err);
}

/** One action at a time; buttons stay disabled while it runs. */
async function guard(action) {
  if (view.busy) return;
  view.busy = true;
  toggleButtons(true);
  el('error').hidden = true;
  try {
    await action();
  } catch (err) {
    showError(err);
  } finally {
    view.busy = false;
    toggleButtons(false);
  }
}

function toggleButtons(disabled) {
  for (const id of ['find', 'auto', 'build', 'saveSpotify', 'saveYouTube', 'locate', 'importSpotify', 'copyLinks']) {
    el(id).disabled = disabled;
  }
  if (!disabled) syncSaveButtons();
}

/* ---------- location ---------- */

async function useMyLocation() {
  setStatus('Asking your browser where you are…', true);
  const place = await locateMe();
  store.setPlace(place);
  el('location').value = place.label;
  el('placeHint').textContent = `Searching around ${place.label}`;
  setStatus(`Found you near ${place.label}.`);
}

/** Reuse the stored place unless the typed location has changed. */
async function currentPlace() {
  const typed = el('location').value.trim();
  const saved = store.getPlace();
  if (!typed) {
    if (saved) return saved;
    throw new Error('Type a city or ZIP — or press "Use my location".');
  }
  if (saved && saved.label.toLowerCase() === typed.toLowerCase()) return saved;

  setStatus(`Looking up ${typed}…`, true);
  const place = await geocode(typed);
  store.setPlace(place);
  el('location').value = place.label;
  el('placeHint').textContent = `Searching around ${place.label}`;
  return place;
}

/** Demo mode shouldn't demand a location — it invents one if you haven't picked. */
async function placeForSearch(source) {
  const needsLocation = source === 'ticketmaster' || source === 'bandsintown';
  if (needsLocation) return currentPlace();
  try {
    return await currentPlace();
  } catch {
    const fallback =
      source === 'local'
        ? await local.area()
        : { label: 'Austin, TX', lat: 30.2672, lon: -97.7431, countryCode: 'US' };
    el('placeHint').textContent =
      source === 'local'
        ? `Centred on ${fallback.label} — the area these listings cover.`
        : 'Demo data centred on Austin, TX — set a location for real listings.';
    return fallback;
  }
}

/* ---------- finding shows ---------- */

async function runFind() {
  const controls = store.getControls();
  const source = SOURCES[controls.source];
  if (!source) throw new Error(`Unknown source "${controls.source}".`);

  const place = await placeForSearch(controls.source);
  const range = resolveRange(controls.range, {
    customStart: controls.customStart,
    customEnd: controls.customEnd,
  });
  const credentials = store.getCredentials();

  setStatus(`Scanning ${source.meta.label} for shows near ${place.label}…`, true);

  const result = await source.findShows({
    apiKey: credentials.ticketmasterKey,
    appId: credentials.bandsintownAppId,
    artists: store.getWatchlist(),
    place,
    radius: Number(controls.radius),
    start: range.start,
    end: range.end,
    genres: controls.genres,
  });

  view.place = place;
  view.shows = result.shows.sort((a, b) => a.start - b.start);
  view.excluded = new Set();
  view.range = range;
  view.tracks = [];
  view.missing = [];
  el('trackList').replaceChildren();
  el('saveRow').hidden = true;
  el('playlistLinks').replaceChildren();
  el('trackCount').textContent = '';

  el('firstRun').hidden = true;
  el('showsPanel').hidden = false;
  el('playlistPanel').hidden = false;
  drawShows();

  const notes = [];
  if (result.generatedAt) {
    const swept = new Date(result.generatedAt);
    notes.push(`Listings swept ${swept.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`);
  }
  if (result.coverage) notes.push(result.coverage);
  if (result.truncated) notes.push(`Showing the first ${view.shows.length} of ${result.total}.`);
  if (result.misses?.length)
    notes.push(`No dates near you for: ${result.misses.slice(0, 8).join(', ')}${result.misses.length > 8 ? '…' : ''}`);
  if (controls.source === 'bandsintown' && controls.genres.length)
    notes.push('Bandsintown listings have no genre tags, so genre filters are ignored for this source.');
  el('showsNote').textContent = notes.join(' ');

  if (!view.shows.length) {
    setStatus('No shows matched. Try a wider radius, a longer window, or fewer genres.');
    return;
  }
  setStatus(
    `Found ${view.shows.length} show${view.shows.length === 1 ? '' : 's'} — uncheck anything you're not into, then build the playlist.`
  );
  syncSaveButtons();
}

function drawShows() {
  renderShows(el('showsList'), view.shows, {
    excluded: view.excluded,
    place: view.place || store.getPlace(),
    onToggle: (id, keep) => {
      if (keep) view.excluded.delete(id);
      else view.excluded.add(id);
      updateShowCount();
      drawShows();
    },
  });
  updateShowCount();
}

function updateShowCount() {
  const kept = view.shows.length - view.excluded.size;
  el('showCount').textContent = `${kept}/${view.shows.length} kept`;
}

function setAllShows(keep) {
  view.excluded = keep ? new Set() : new Set(view.shows.map((s) => s.id));
  drawShows();
}

function selectedShows() {
  return view.shows.filter((show) => !view.excluded.has(show.id));
}

/* ---------- building the playlist ---------- */

async function runBuild() {
  const shows = selectedShows();
  if (!shows.length) throw new Error('Keep at least one show first.');

  const controls = store.getControls();
  const artists = artistsFromShows(shows, { maxArtists: controls.maxArtists });
  view.artists = artists;

  const useSpotify = spotify.isConnected();
  view.provider = useSpotify ? 'spotify' : 'itunes';
  setStatus(`Looking up top tracks for ${artists.length} artists…`, true);

  const progress = (done, total) => setStatus(`Looking up top tracks… ${done}/${total} artists`, true);
  const results = useSpotify
    ? await spotify.resolveTracks(artists, {
        perArtist: controls.tracksPerArtist,
        market: spotify.account()?.market || 'US',
        onProgress: progress,
      })
    : await itunes.resolveTracks(artists, {
        perArtist: controls.tracksPerArtist,
        onProgress: progress,
      });

  let { tracks, missing } = buildTracklist(results);
  let fellBack = null;

  if (useSpotify && !tracks.length && artists.length) {
    fellBack = commonReason(missing);
    setStatus('Spotify lookups failed — falling back to the public catalogue…', true);
    view.provider = 'itunes';
    ({ tracks, missing } = buildTracklist(
      await itunes.resolveTracks(artists, {
        perArtist: controls.tracksPerArtist,
        onProgress: progress,
      })
    ));
  }

  view.tracks = tracks;
  view.missing = missing;

  renderTracks(el('trackList'), tracks);
  el('trackCount').textContent = `${tracks.length} tracks · ${artists.length - missing.length} artists`;
  el('saveRow').hidden = tracks.length === 0;
  syncSaveButtons();

  el('playlistNote').textContent = useSpotify && !fellBack
    ? "Top 3 tracks for each artist you've kept, from Spotify, in show order."
    : "Top 3 tracks for each artist you've kept, in show order. No Spotify app? Use the links on each track, or Copy list and paste it into an importer like Spotlistr.";

  // Name the reason, not just the artists — "skipped 42" with no cause is
  // useless when something systemic is wrong.
  const reason = commonReason(missing);
  const skipped = missing.length
    ? ` Skipped ${missing.length} (${missing
        .slice(0, 3)
        .map((m) => m.name)
        .join(', ')}${missing.length > 3 ? '…' : ''}${reason ? ` — ${reason}` : ''}).`
    : '';

  if (fellBack) {
    showError(
      new Error(
        `Spotify couldn't provide tracks, so these came from the public catalogue instead ` +
          `and can't be saved to Spotify. ${fellBack}`
      )
    );
  }
  setStatus(
    tracks.length
      ? `Playlist ready: ${tracks.length} tracks.${skipped} Save it wherever you like.`
      : `Couldn't find tracks for any of those artists.${skipped}`
  );
}

/** The reason that stopped the most artists, for a status line worth reading. */
function commonReason(missing) {
  const counts = new Map();
  for (const item of missing) {
    if (!item.reason) continue;
    counts.set(item.reason, (counts.get(item.reason) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

/* ---------- saving ---------- */

function playlistMeta() {
  const controls = store.getControls();
  return {
    title: playlistTitle({ place: view.place, start: view.range.start, end: view.range.end }),
    description: playlistDescription({
      tracks: view.tracks,
      artists: view.artists,
      place: view.place,
      start: view.range.start,
      end: view.range.end,
      source: controls.source,
    }),
  };
}

async function saveToSpotify() {
  if (!view.tracks.length) throw new Error('Build a playlist first.');
  if (!spotify.isConnected()) throw new Error('Connect Spotify in Setup first.');
  if (view.provider !== 'spotify')
    throw new Error('These tracks came from YouTube search. Rebuild with Spotify connected to save there.');

  const meta = playlistMeta();
  setStatus('Creating the playlist in your Spotify account…', true);

  let result;
  try {
    result = await spotify.createPlaylist({
      ...meta,
      tracks: view.tracks,
      onProgress: (done, total) => setStatus(`Adding tracks… ${done}/${total}`, true),
    });
  } catch (err) {
    if (!/403/.test(err.message)) throw err;
    // Reading works, writing doesn't: this Spotify app isn't allowed to create
    // playlists. Nothing here can fix that, so point at the route that works.
    view.spotifyWritesBlocked = true;
    syncSaveButtons();
    throw new Error(
      'Spotify refused to create the playlist (403 Forbidden — not a scope problem, ' +
        'both private and public are refused). This Spotify app can read but not write. ' +
        'Use Copy list and paste into an importer like Spotlistr, which has its own ' +
        'approved app — the tracklist is already on your clipboard-ready list below.'
    );
  }

  renderLinks(el('playlistLinks'), [
    { label: `Open "${meta.title}" on Spotify`, url: result.url, note: `${result.trackCount} tracks` },
  ]);
  setStatus(`Saved ${result.trackCount} tracks to Spotify.`);
}

async function saveToYouTube() {
  if (!view.tracks.length) throw new Error('Build a playlist first.');
  if (!youtube.isConnected()) {
    await connectYouTube();
  }

  let videoTracks = view.tracks.filter((t) => t.videoId);
  const needSearch = view.tracks.length - videoTracks.length;

  if (needSearch) {
    const cost = youtube.estimateQuota({ searches: needSearch, tracks: view.tracks.length });
    const ok = window.confirm(
      `Matching ${needSearch} tracks to YouTube videos costs about ${cost.toLocaleString()} of ` +
        `your ${youtube.QUOTA.dailyDefault.toLocaleString()} daily API units. Continue?`
    );
    if (!ok) {
      setStatus('YouTube save cancelled.');
      return;
    }
    setStatus('Matching tracks to YouTube videos…', true);
    const matched = await youtube.matchTracks(
      view.tracks.filter((t) => !t.videoId),
      { onProgress: (done, total) => setStatus(`Matching on YouTube… ${done}/${total}`, true) }
    );
    videoTracks = view.tracks
      .map((t) => (t.videoId ? t : matched.find((m) => m.id === t.id && m.videoId)))
      .filter(Boolean);
  }

  if (!videoTracks.length) throw new Error('None of those tracks turned up on YouTube.');

  const meta = playlistMeta();
  setStatus('Creating the playlist on YouTube…', true);
  const result = await youtube.createPlaylist({
    ...meta,
    videoIds: videoTracks.map((t) => t.videoId),
    onProgress: (done, total) => setStatus(`Adding videos… ${done}/${total}`, true),
  });

  renderLinks(el('playlistLinks'), [
    { label: `Open "${meta.title}" on YouTube`, url: result.url, note: `${result.trackCount} videos` },
  ]);
  setStatus(
    `Saved ${result.trackCount} videos to YouTube${result.skipped ? ` (${result.skipped} couldn't be added)` : ''}.`
  );
}

async function copyList() {
  if (!view.tracks.length) throw new Error('Build a playlist first.');
  await navigator.clipboard.writeText(toText(view.tracks));
  setStatus(
    'Copied as "Artist - Title" lines — paste straight into a playlist importer like Spotlistr or Soundiiz.'
  );
}

async function copyLinks() {
  if (!view.tracks.length) throw new Error('Build a playlist first.');
  await navigator.clipboard.writeText(
    toLinkList(view.tracks, {
      formatShow: (show) =>
        show ? `${formatDay(show.displayDate || show.start)}, ${show.venue?.name || 'TBA'}` : '',
    })
  );
  setStatus('Copied a markdown list with a YouTube and Spotify link per track.');
}

function downloadJson() {
  if (!view.tracks.length) {
    showError(new Error('Build a playlist first.'));
    return;
  }
  const json = toJson({
    tracks: view.tracks,
    shows: selectedShows(),
    place: view.place,
    start: view.range.start,
    end: view.range.end,
    source: store.getControls().source,
  });
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'showlist.json';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded showlist.json.');
}

/* ---------- the one-click path ---------- */

async function runAuto() {
  const controls = store.getControls();
  const credentials = store.getCredentials();
  // Preloaded listings need nothing; a key unlocks anywhere else.
  const source = controls.source === 'local' || !credentials.ticketmasterKey ? 'local' : 'ticketmaster';
  store.setControls({ source, range: '14', radius: source === 'local' ? 60 : 25, genres: [] });
  restoreControls();
  syncSourcePanels();

  if (source !== 'local' && !store.getPlace() && !el('location').value.trim()) {
    try {
      await useMyLocation();
    } catch (err) {
      throw new Error(`${err.message} Then press "Just do it for me" again.`);
    }
  }

  await runFind();
  if (!view.shows.length) return;
  await runBuild();
}

/* ---------- services ---------- */

function refreshServiceChips() {
  const spotifyOn = spotify.isConnected();
  const youtubeOn = youtube.isConnected();
  el('spotifyChip').classList.toggle('on', spotifyOn);
  el('youtubeChip').classList.toggle('on', youtubeOn);
  el('spotifyChip').title = spotifyOn
    ? `Connected as ${spotify.account()?.name || 'you'} — click to disconnect`
    : 'Not connected — click to connect';
  el('youtubeChip').title = youtubeOn
    ? 'Connected — click to disconnect'
    : 'Not connected — click to connect';
  el('connectSpotify').textContent = spotifyOn ? 'Disconnect Spotify' : 'Connect Spotify';
  el('connectYouTube').textContent = youtubeOn ? 'Disconnect YouTube' : 'Connect YouTube';
  syncSaveButtons();
}

function syncSaveButtons() {
  if (view.busy) return;
  el('saveSpotify').disabled =
    !view.tracks.length ||
    !spotify.isConnected() ||
    view.provider !== 'spotify' ||
    view.spotifyWritesBlocked;
  el('saveSpotify').title = view.spotifyWritesBlocked
    ? 'This Spotify app is not allowed to create playlists — use Copy list instead'
    : spotify.isConnected()
      ? ''
      : 'Connect Spotify in Setup to save playlists to your account';
  el('saveYouTube').disabled = !view.tracks.length;
  el('copyLinks').disabled = !view.tracks.length;
}

async function connectSpotify() {
  if (spotify.isConnected()) {
    spotify.disconnect();
    refreshServiceChips();
    setStatus('Disconnected from Spotify.');
    return;
  }
  saveSetup({ silent: true });
  setStatus('Sending you to Spotify to sign in…', true);
  await spotify.connect(store.getCredentials().spotifyClientId);
}

const toggleSpotify = connectSpotify;

async function connectYouTube() {
  if (youtube.isConnected()) {
    youtube.disconnect();
    refreshServiceChips();
    setStatus('Disconnected from YouTube.');
    return;
  }
  saveSetup({ silent: true });
  setStatus('Opening Google sign-in…', true);
  await youtube.connect(store.getCredentials().googleClientId);
  refreshServiceChips();
  setStatus('YouTube connected for this browser tab.');
}

const toggleYouTube = connectYouTube;

async function finishSpotifyRedirect() {
  try {
    const outcome = await spotify.completeRedirect();
    if (outcome === 'connected') {
      refreshServiceChips();
      setStatus(`Spotify connected as ${spotify.account()?.name || 'you'}.`);
    }
  } catch (err) {
    showError(err);
  }
}

async function importWatchlist() {
  if (!spotify.isConnected()) throw new Error('Connect Spotify first — that\'s where the names come from.');
  setStatus('Reading your Spotify artists…', true);
  const names = await spotify.listeningArtists();
  if (!names.length) throw new Error('Spotify returned no artists to import.');
  const merged = [...new Set([...store.getWatchlist(), ...names])];
  store.setWatchlist(merged);
  el('watchlist').value = merged.join('\n');
  updateWatchlistCount();
  setStatus(`Imported ${names.length} artists into your watchlist.`);
}

function updateWatchlistCount() {
  const count = store.getWatchlist().length;
  el('watchlistCount').textContent = count ? `${count} artists watched` : '';
}

/* ---------- setup dialog ---------- */

function saveSetup({ silent = false } = {}) {
  store.setCredentials({
    ticketmasterKey: el('tmKey').value.trim(),
    bandsintownAppId: el('bitAppId').value.trim(),
    spotifyClientId: el('spotifyClientId').value.trim(),
    googleClientId: el('googleClientId').value.trim(),
  });
  if (!silent) {
    el('setupDialog').close();
    setStatus('Saved. Keys stay in this browser.');
  }
}

async function copyRedirect() {
  await navigator.clipboard.writeText(store.redirectUri());
  setStatus('Redirect URI copied.');
}

function clearData() {
  if (!window.confirm('Forget all keys, tokens and saved settings in this browser?')) return;
  spotify.disconnect();
  youtube.disconnect();
  store.clearEverything();
  el('setupDialog').close();
  window.location.reload();
}

// Expose a little surface for smoke tests and console poking.
window.showlist = { view, store, spotify, youtube, GENRES };
