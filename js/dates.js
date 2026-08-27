// Date-range presets and the formats each concert API wants.

export const RANGE_PRESETS = [
  { id: 'weekend', label: 'This weekend' },
  { id: '7', label: 'Next 7 days' },
  { id: '14', label: 'Next 14 days' },
  { id: '30', label: 'Next 30 days' },
  { id: '90', label: 'Next 90 days' },
  { id: 'custom', label: 'Custom' },
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 0);
const addDays = (d, n) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

/**
 * Resolve a preset into a concrete local [start, end] window.
 * `now` is injectable so this stays testable.
 */
export function resolveRange(preset, { now = new Date(), customStart, customEnd } = {}) {
  if (preset === 'custom') {
    const start = customStart ? startOfDay(parseLocalDate(customStart)) : now;
    const end = customEnd ? endOfDay(parseLocalDate(customEnd)) : endOfDay(addDays(now, 14));
    if (end < start) throw new Error('That date range ends before it starts.');
    return { start, end };
  }

  if (preset === 'weekend') {
    // Friday 00:00 through Sunday 23:59 of the weekend we're in or heading into.
    const day = now.getDay(); // 0 Sun … 6 Sat
    const daysUntilFriday = day === 0 ? -2 : (5 - day + 7) % 7;
    const friday = startOfDay(addDays(now, daysUntilFriday));
    const start = friday < now && day !== 0 ? now : friday;
    return { start, end: endOfDay(addDays(friday, 2)) };
  }

  const days = Number(preset);
  if (!Number.isFinite(days) || days <= 0) throw new Error(`Unknown date range "${preset}".`);
  return { start: now, end: endOfDay(addDays(now, days - 1)) };
}

function parseLocalDate(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Ticketmaster wants UTC with no milliseconds: 2026-08-27T18:30:00Z */
export function toTicketmasterStamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Bandsintown wants a local-date range: 2026-08-27,2026-09-10 */
export function toBandsintownRange(start, end) {
  return `${toISODate(start)},${toISODate(end)}`;
}

export function toISODate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatDay(date) {
  return DAY_FMT.format(date);
}

export function formatTime(date) {
  return TIME_FMT.format(date);
}

/** "Aug 27 – Sep 10" — used in playlist titles. */
export function formatRangeShort(start, end) {
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}
