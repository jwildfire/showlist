// Rendering. Every function here is pure DOM: data in, nodes out.

import { GENRES, genreLabel } from './genres.js';
import { formatDay, formatTime } from './dates.js';
import { milesBetween } from './geo.js';
import { spotifySearch, youtubeSearch } from './links.js';

export function renderGenreChips(container, selected, onToggle) {
  container.replaceChildren();
  const all = chip('All genres', selected.size === 0, () => onToggle(null));
  container.append(all);
  for (const genre of GENRES) {
    container.append(chip(genre.label, selected.has(genre.id), () => onToggle(genre.id)));
  }
}

function chip(label, pressed, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'genre-chip';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', onClick);
  return button;
}

export function renderShows(container, shows, { excluded, place, onToggle }) {
  container.replaceChildren();

  for (const show of shows) {
    const li = document.createElement('li');
    li.className = 'show' + (excluded.has(show.id) ? ' off' : '');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !excluded.has(show.id);
    box.id = `show-${cssId(show.id)}`;
    box.addEventListener('change', () => onToggle(show.id, box.checked));

    const body = document.createElement('div');
    body.className = 'show-body';

    const title = document.createElement('label');
    title.className = 'show-artist';
    title.htmlFor = box.id;
    title.textContent = show.artists.map((a) => a.name).join(' + ');

    const meta = document.createElement('div');
    meta.className = 'show-meta';
    const when = show.displayDate || show.start;
    meta.append(span('show-date', `${formatDay(when)}${show.dateTBA ? '' : ` · ${formatTime(when)}`}`));
    meta.append(span('', venueLine(show, place)));
    if (show.genre) meta.append(span('badge', genreLabel(show.genre) || show.genre));
    if (show.url) {
      const link = document.createElement('a');
      link.href = show.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'tickets ↗';
      meta.append(link);
    }

    body.append(title, meta);
    li.append(box, body);
    container.append(li);
  }
}

function venueLine(show, place) {
  const parts = [show.venue?.name, [show.venue?.city, show.venue?.state].filter(Boolean).join(', ')];
  const miles = place ? milesBetween(place, show.venue) : Infinity;
  if (Number.isFinite(miles) && miles < 500) parts.push(`${miles < 1 ? '<1' : Math.round(miles)} mi`);
  return parts.filter(Boolean).join(' · ');
}

export function renderTracks(container, tracks) {
  container.replaceChildren();

  tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track';

    li.append(span('track-num', String(i + 1)));

    const body = document.createElement('div');
    body.className = 'track-body';
    const title = document.createElement('div');
    title.className = 'track-title';
    if (track.url) {
      const link = document.createElement('a');
      link.href = track.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = track.title;
      title.append(link);
    } else {
      title.textContent = track.title;
    }
    body.append(title, span('track-artist', track.artistName));

    // Search links work for everyone — no key, no login, nothing to connect.
    const links = document.createElement('div');
    links.className = 'track-links';
    links.append(
      outLink(youtubeSearch(track), 'YouTube'),
      outLink(spotifySearch(track), 'Spotify')
    );
    if (track.preview) links.append(preview(track.preview));
    body.append(links);
    li.append(body);

    if (track.show) {
      li.append(
        span(
          'track-when',
          `${formatDay(track.show.displayDate || track.show.start)} · ${track.show.venue?.name || 'TBA'}`
        )
      );
    }
    container.append(li);
  });
}

export function renderLinks(container, entries) {
  container.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('div');
    if (entry.url) {
      const link = document.createElement('a');
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = entry.label;
      row.append(link);
      if (entry.note) row.append(span('hint', ` ${entry.note}`));
    } else {
      row.className = 'hint';
      row.textContent = entry.label;
    }
    container.append(row);
  }
}

function outLink(href, label) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = label;
  return link;
}

/** A 30-second preview, when the catalogue hands us one. */
function preview(src) {
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'none';
  audio.src = src;
  audio.className = 'track-preview';
  return audio;
}

function span(className, text) {
  const el = document.createElement('span');
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function cssId(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '_');
}
