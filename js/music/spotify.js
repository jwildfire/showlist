// Spotify: PKCE auth (no server, no client secret), artist lookup, top tracks,
// and playlist creation. Tokens live in this browser only.

import { redirectUri } from '../state.js';
import { chunk, normalizeName, pool, randomString } from '../util.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const STORE = 'showlist:spotify';
const PENDING = 'showlist:spotify:pending';

const MAX_ATTEMPTS = 3;

const SCOPES = [
  'playlist-modify-private',
  'playlist-modify-public',
  'user-top-read',
  'user-follow-read',
  'user-read-private',
];

export const service = { id: 'spotify', label: 'Spotify' };

let session = read();
// Set once we learn this app can't reach /artists/{id}/top-tracks, so a
// 40-artist build doesn't make 40 doomed calls.
let topTracksBlocked = false;

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}

function write(next) {
  session = next;
  try {
    if (next) localStorage.setItem(STORE, JSON.stringify(next));
    else localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}

export function isConnected() {
  return Boolean(session?.refreshToken || (session?.accessToken && session.expiresAt > Date.now()));
}

export function account() {
  return session?.profile || null;
}

export function disconnect() {
  write(null);
}

/** Send the browser off to Spotify's consent screen. */
export async function connect(clientId) {
  if (!clientId) throw new Error('Add your Spotify client ID in Setup first.');
  const verifier = randomString(48);
  const state = randomString(8);
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, clientId }));

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', await challenge(verifier));
  url.searchParams.set('state', state);
  window.location.assign(url.toString());
}

/**
 * Call once on load. Finishes the OAuth handshake if we just came back from
 * Spotify, and always leaves the address bar clean.
 * @returns {Promise<'connected'|'none'>}
 */
export async function completeRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return 'none';

  const pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
  sessionStorage.removeItem(PENDING);
  cleanUrl();

  if (error === 'access_denied') {
    // Same error code whether you pressed cancel or your account simply isn't
    // on the app's allowlist — a new Spotify app is limited to its owner plus
    // 25 accounts added in the dashboard.
    throw new Error(
      'Spotify declined the sign-in. Either you cancelled, or this app is still in ' +
        "Spotify's development mode and your account hasn't been added to it — the owner " +
        'can add you under User Management in the Spotify dashboard. You can also put your ' +
        'own Spotify client ID in Setup and use your own app.'
    );
  }
  if (error) throw new Error(`Spotify sign-in failed (${error}).`);
  if (!pending) throw new Error('Spotify sign-in got out of sync — try connecting again.');
  if (pending.state !== params.get('state'))
    throw new Error('Spotify sign-in failed a security check — try again.');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: pending.clientId,
    code_verifier: pending.verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      json.error_description ||
        'Spotify refused the sign-in. Check the client ID and that this exact URL is a registered redirect URI.'
    );

  write({
    clientId: pending.clientId,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000 - 30000,
    profile: null,
  });
  write({ ...session, profile: await me() });
  return 'connected';
}

async function token() {
  if (!session) throw new Error('Connect Spotify first.');
  if (session.accessToken && session.expiresAt > Date.now()) return session.accessToken;
  if (!session.refreshToken) {
    write(null);
    throw new Error('Spotify session expired — connect again.');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: session.clientId,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    write(null);
    throw new Error('Spotify session expired — connect again.');
  }
  write({
    ...session,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000 - 30000,
  });
  return session.accessToken;
}

async function api(path, { method = 'GET', body, attempt = 1 } = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && attempt === 1) {
    write({ ...session, accessToken: null, expiresAt: 0 });
    return api(path, { method, body, attempt: 2 });
  }
  // Apps in Spotify's development mode have a tight rate limit, and a 40-artist
  // build is ~80 calls. Back off and keep going rather than losing the batch.
  if (res.status === 429 && attempt <= MAX_ATTEMPTS) {
    const wait = Number(res.headers.get('Retry-After')) || attempt * 2;
    await new Promise((r) => setTimeout(r, Math.min(wait, 12) * 1000));
    return api(path, { method, body, attempt: attempt + 1 });
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const message = detail.error?.message || detail.error_description || '';
    // 403 on a valid token is almost always the app's own configuration, not
    // anything a retry fixes.
    if (res.status === 403) {
      throw new Error(
        'Spotify returned 403 Forbidden — apps in development mode can’t reach this ' +
          'endpoint. Retrying will not help.'
      );
    }
    throw new Error(
      res.status === 429
        ? 'Spotify rate limit — too many lookups at once.'
        : `Spotify error ${res.status}${message ? `: ${message}` : ''}`
    );
  }
  return res.status === 204 ? null : res.json();
}

export async function me() {
  const profile = await api('/me');
  return {
    id: profile.id,
    name: profile.display_name || profile.id,
    market: profile.country || 'US',
    url: profile.external_urls?.spotify || '',
  };
}

/** Best-effort artist match. Exact-ish name wins; otherwise most popular. */
export async function findArtist(name) {
  const q = encodeURIComponent(name);
  const body = await api(`/search?q=${q}&type=artist&limit=5`);
  const items = body.artists?.items || [];
  if (!items.length) return null;
  const target = normalizeName(name);
  const exact = items.filter((a) => normalizeName(a.name) === target);
  const pick = (exact.length ? exact : items).sort((a, b) => b.popularity - a.popularity)[0];
  return {
    id: pick.id,
    name: pick.name,
    popularity: pick.popularity,
    image: pick.images?.[pick.images.length - 1]?.url || '',
    url: pick.external_urls?.spotify || '',
    exact: normalizeName(pick.name) === target,
  };
}

export async function topTracks(artistId, market = 'US') {
  const body = await api(`/artists/${artistId}/top-tracks?market=${market}`);
  return (body.tracks || []).map(toTrack);
}

/**
 * The same job through /search, which development-mode apps can still reach —
 * Spotify restricts /artists/{id}/top-tracks for them. Ranked by Spotify's own
 * popularity score, with the same song on three reissues collapsed to one.
 */
export async function popularTracks(name, market = 'US', limit = 3) {
  // Keep the request in the plainest shape Spotify accepts: a bare keyword
  // query, no field filters, no quotes. The `artist:"…"` form and the market
  // parameter both drew 400s from a real development-mode app, and the
  // artist matching below doesn't need Spotify to do the filtering.
  const q = encodeURIComponent(name);
  let body;
  try {
    body = await api(`/search?q=${q}&type=track&limit=20`);
  } catch (err) {
    if (!/40[03]/.test(err.message)) throw err;
    body = await api(`/search?q=${q}&type=track`); // last resort: defaults only
  }
  const target = normalizeName(name);
  const seen = new Set();
  const tracks = [];

  for (const item of (body.tracks?.items || []).sort((a, b) => b.popularity - a.popularity)) {
    if (!(item.artists || []).some((a) => normalizeName(a.name) === target)) continue;
    const key = normalizeName(item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push(toTrack(item));
    if (tracks.length >= limit) break;
  }
  return tracks;
}

function toTrack(t) {
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    album: t.album?.name || '',
    durationMs: t.duration_ms,
    popularity: t.popularity,
    url: t.external_urls?.spotify || '',
    art: t.album?.images?.[t.album.images.length - 1]?.url || '',
  };
}

/** Artists to seed a Bandsintown watchlist with. */
export async function listeningArtists({ limit = 50 } = {}) {
  const names = new Set();
  for (const term of ['short_term', 'medium_term']) {
    const body = await api(`/me/top/artists?limit=${limit}&time_range=${term}`).catch(() => null);
    for (const a of body?.items || []) names.add(a.name);
  }
  const followed = await api(`/me/following?type=artist&limit=${limit}`).catch(() => null);
  for (const a of followed?.artists?.items || []) names.add(a.name);
  return [...names];
}

export async function createPlaylist({ title, description, tracks, isPublic = false, onProgress }) {
  const profile = session?.profile || (await me());
  const playlist = await api(`/users/${encodeURIComponent(profile.id)}/playlists`, {
    method: 'POST',
    body: { name: title, description, public: isPublic },
  });

  const uris = tracks.map((t) => t.uri).filter(Boolean);
  let added = 0;
  for (const batch of chunk(uris, 100)) {
    await api(`/playlists/${playlist.id}/tracks`, { method: 'POST', body: { uris: batch } });
    added += batch.length;
    onProgress?.(added, uris.length);
  }

  return {
    id: playlist.id,
    url: playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`,
    trackCount: added,
  };
}

/** Resolve many artists to their top tracks, politely. */
export async function resolveTracks(artists, { perArtist = 3, market = 'US', onProgress } = {}) {
  let done = 0;
  return pool(artists, 2, async (artist) => {
    try {
      const match = artist.spotifyId
        ? { id: artist.spotifyId, name: artist.name, exact: true }
        : await findArtist(artist.name);
      if (!match) return { artist, tracks: [], reason: 'not on Spotify' };

      let tracks = [];
      if (!topTracksBlocked) {
        try {
          tracks = (await topTracks(match.id, market)).slice(0, perArtist);
        } catch (err) {
          if (!/403/.test(err.message)) throw err;
          topTracksBlocked = true;
        }
      }
      if (!tracks.length) tracks = await popularTracks(match.name, market, perArtist);

      return { artist, match, tracks, reason: tracks.length ? null : 'no tracks in your market' };
    } catch (err) {
      return { artist, tracks: [], reason: err.message };
    } finally {
      onProgress?.(++done, artists.length);
    }
  });
}

async function challenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function cleanUrl() {
  const url = new URL(window.location.href);
  ['code', 'state', 'error'].forEach((p) => url.searchParams.delete(p));
  window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
}
