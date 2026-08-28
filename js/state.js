// Everything the app remembers between visits. Nothing leaves this browser.

import { CONFIG } from './config.js';

const KEY = 'showlist:v1';

export const DEFAULT_CONTROLS = {
  source: 'local',
  location: '',
  radius: 60,
  range: '14',
  customStart: '',
  customEnd: '',
  genres: [], // empty = every genre
  tracksPerArtist: 3,
  maxArtists: 80,
  compact: true,
};

const DEFAULT_STATE = {
  credentials: {
    ticketmasterKey: '',
    bandsintownAppId: '',
    spotifyClientId: '',
    googleClientId: '',
  },
  controls: { ...DEFAULT_CONTROLS },
  place: null, // { label, lat, lon, countryCode }
  watchlist: [], // artist names, for the Bandsintown source
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const saved = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...saved,
      credentials: { ...DEFAULT_STATE.credentials, ...(saved.credentials || {}) },
      controls: { ...DEFAULT_CONTROLS, ...(saved.controls || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode, quota, whatever — the app still works for this session */
  }
}

export function getState() {
  return state;
}

/**
 * What you typed in Setup wins; otherwise fall back to the client IDs the site
 * ships with, so a deployed copy can be zero-setup.
 */
export function getCredentials() {
  return {
    ...state.credentials,
    spotifyClientId: state.credentials.spotifyClientId || CONFIG.spotifyClientId || '',
    googleClientId: state.credentials.googleClientId || CONFIG.googleClientId || '',
  };
}

/** Only what this browser has stored — used to fill the Setup fields. */
export function getStoredCredentials() {
  return { ...state.credentials };
}

/** True when the site itself supplies this credential. */
export function hasBuiltIn(name) {
  return Boolean(CONFIG[name]);
}

export function setCredentials(patch) {
  state.credentials = { ...state.credentials, ...patch };
  persist();
}

export function getControls() {
  return { ...state.controls };
}

export function setControls(patch) {
  state.controls = { ...state.controls, ...patch };
  persist();
}

export function getPlace() {
  return state.place;
}

export function setPlace(place) {
  state.place = place;
  if (place?.label) state.controls.location = place.label;
  persist();
}

export function getWatchlist() {
  return [...state.watchlist];
}

export function setWatchlist(names) {
  state.watchlist = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  persist();
}

export function clearEverything() {
  state = structuredClone(DEFAULT_STATE);
  try {
    localStorage.removeItem(KEY);
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

/**
 * The exact redirect URI to register with Spotify and Google. Both providers
 * match it character for character, so we always hand back the canonical
 * directory form of wherever the app is being served from.
 */
export function redirectUri() {
  const { origin, pathname } = window.location;
  const dir = pathname.replace(/index\.html$/, '');
  return origin + (dir.endsWith('/') ? dir : dir + '/');
}
