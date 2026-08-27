// YouTube: Google Identity Services token flow (popup, no secret) plus the
// three Data API calls we need — search, playlists.insert, playlistItems.insert.

import { pool } from '../util.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/youtube/v3';
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const STORE = 'showlist:youtube';

// Data API quota costs, so we can warn before burning a day's allowance.
export const QUOTA = { search: 100, playlistInsert: 50, itemInsert: 50, dailyDefault: 10000 };

export const service = { id: 'youtube', label: 'YouTube' };

let session = readSession();
let gisPromise = null;
let tokenClient = null;

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    return saved && saved.expiresAt > Date.now() ? saved : null;
  } catch {
    return null;
  }
}

function writeSession(next) {
  session = next;
  try {
    if (next) sessionStorage.setItem(STORE, JSON.stringify(next));
    else sessionStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}

export function isConnected() {
  return Boolean(session?.accessToken && session.expiresAt > Date.now());
}

export function disconnect() {
  const token = session?.accessToken;
  writeSession(null);
  tokenClient = null;
  if (token) navigator.sendBeacon?.(`https://oauth2.googleapis.com/revoke?token=${token}`);
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load Google sign-in. Check your connection."));
    document.head.appendChild(script);
  });
  return gisPromise;
}

/** Opens Google's consent popup and keeps the access token for this tab. */
export async function connect(clientId) {
  if (!clientId) throw new Error('Add your Google OAuth client ID in Setup first.');
  await loadGis();

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Google sign-in failed (${response.error}).`));
          return;
        }
        writeSession({
          clientId,
          accessToken: response.access_token,
          expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000 - 30000,
        });
        resolve(true);
      },
      error_callback: (err) =>
        reject(
          new Error(
            err?.type === 'popup_closed'
              ? 'Google sign-in window was closed.'
              : 'Google sign-in was blocked — allow popups for this site and try again.'
          )
        ),
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

async function api(path, { method = 'GET', body, params } = {}) {
  if (!isConnected()) throw new Error('Connect YouTube first.');
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    writeSession(null);
    throw new Error('YouTube session expired — connect again.');
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const reason = detail.error?.errors?.[0]?.reason || '';
    if (reason === 'quotaExceeded')
      throw new Error(
        'YouTube daily API quota exhausted. It resets at midnight Pacific — or request more quota in Google Cloud.'
      );
    throw new Error(detail.error?.message || `YouTube error ${res.status}`);
  }
  return res.json();
}

/** One search call per query; `limit` results come back for the same 100 units. */
export async function searchVideos(query, limit = 1) {
  const body = await api('/search', {
    params: {
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10', // Music
      maxResults: String(limit),
      q: query,
    },
  });
  return (body.items || []).map((item) => ({
    videoId: item.id?.videoId,
    title: item.snippet?.title || '',
    channel: item.snippet?.channelTitle || '',
    art: item.snippet?.thumbnails?.default?.url || '',
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
  }));
}

/** Find a video for each already-chosen track (one search per track). */
export async function matchTracks(tracks, { onProgress } = {}) {
  let done = 0;
  return pool(tracks, 2, async (track) => {
    try {
      const [hit] = await searchVideos(`${track.artistName} ${track.title}`, 1);
      return hit?.videoId ? { ...track, videoId: hit.videoId, youtubeTitle: hit.title } : null;
    } catch (err) {
      if (/quota/i.test(err.message)) throw err;
      return null;
    } finally {
      onProgress?.(++done, tracks.length);
    }
  }).then((rows) => rows.filter(Boolean));
}

/** No Spotify? Take each artist's top music videos straight from search. */
export async function resolveTracks(artists, { perArtist = 3, onProgress } = {}) {
  let done = 0;
  return pool(artists, 2, async (artist) => {
    try {
      const videos = await searchVideos(artist.name, perArtist);
      return {
        artist,
        tracks: videos.map((v) => ({
          id: v.videoId,
          videoId: v.videoId,
          title: v.title,
          artistName: artist.name,
          url: v.url,
          art: v.art,
        })),
        reason: videos.length ? null : 'nothing on YouTube',
      };
    } catch (err) {
      return { artist, tracks: [], reason: err.message };
    } finally {
      onProgress?.(++done, artists.length);
    }
  });
}

export async function createPlaylist({ title, description, videoIds, isPublic = false, onProgress }) {
  const playlist = await api('/playlists', {
    method: 'POST',
    params: { part: 'snippet,status' },
    body: {
      snippet: { title, description },
      status: { privacyStatus: isPublic ? 'public' : 'private' },
    },
  });

  let added = 0;
  const skipped = [];
  for (const videoId of videoIds) {
    try {
      await api('/playlistItems', {
        method: 'POST',
        params: { part: 'snippet' },
        body: {
          snippet: { playlistId: playlist.id, resourceId: { kind: 'youtube#video', videoId } },
        },
      });
      added++;
    } catch (err) {
      if (/quota/i.test(err.message)) throw Object.assign(err, { partial: { added, skipped } });
      skipped.push(videoId);
    }
    onProgress?.(added + skipped.length, videoIds.length);
  }

  return {
    id: playlist.id,
    url: `https://www.youtube.com/playlist?list=${playlist.id}`,
    trackCount: added,
    skipped: skipped.length,
  };
}

export function estimateQuota({ searches, tracks }) {
  return searches * QUOTA.search + QUOTA.playlistInsert + tracks * QUOTA.itemInsert;
}
