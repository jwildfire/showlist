// One genre vocabulary for the UI, mapped onto whatever each source calls things.

export const GENRES = [
  { id: 'rock', label: 'Rock', ticketmaster: 'Rock' },
  { id: 'alternative', label: 'Indie / Alt', ticketmaster: 'Alternative' },
  { id: 'metal', label: 'Metal', ticketmaster: 'Metal' },
  { id: 'pop', label: 'Pop', ticketmaster: 'Pop' },
  { id: 'hiphop', label: 'Hip-Hop / Rap', ticketmaster: 'Hip-Hop/Rap' },
  { id: 'rnb', label: 'R&B / Soul', ticketmaster: 'R&B' },
  { id: 'electronic', label: 'Electronic', ticketmaster: 'Dance/Electronic' },
  { id: 'country', label: 'Country', ticketmaster: 'Country' },
  { id: 'folk', label: 'Folk / Americana', ticketmaster: 'Folk' },
  { id: 'jazz', label: 'Jazz', ticketmaster: 'Jazz' },
  { id: 'blues', label: 'Blues', ticketmaster: 'Blues' },
  { id: 'latin', label: 'Latin', ticketmaster: 'Latin' },
  { id: 'world', label: 'World', ticketmaster: 'World' },
  { id: 'classical', label: 'Classical', ticketmaster: 'Classical' },
];

const BY_ID = new Map(GENRES.map((g) => [g.id, g]));

export function ticketmasterNames(genreIds) {
  return (genreIds || []).map((id) => BY_ID.get(id)?.ticketmaster).filter(Boolean);
}

/**
 * Fold a source's free-text genre onto one of our ids, so a show found via any
 * source can still be filtered and badged consistently.
 */
export function normalizeGenre(raw) {
  const text = String(raw || '').toLowerCase();
  if (!text || text === 'undefined' || text === 'other') return null;
  const rules = [
    ['hiphop', /hip.?hop|rap|trap/],
    ['rnb', /r&b|rhythm|soul|funk|motown/],
    ['electronic', /dance|electronic|edm|house|techno|dubstep|dj/],
    ['metal', /metal|hardcore|punk/],
    ['country', /country|bluegrass/],
    ['folk', /folk|americana|singer.?songwriter/],
    ['jazz', /jazz|swing|big band/],
    ['blues', /blues/],
    ['latin', /latin|reggaeton|salsa|cumbia|mariachi|tejano/],
    ['classical', /classical|orchestra|symphony|opera|chamber/],
    ['alternative', /alternative|indie|emo|shoegaze|grunge/],
    ['world', /world|reggae|afro|celtic|k-pop|j-pop/],
    ['rock', /rock|jam band|psychedelic/],
    ['pop', /pop/],
  ];
  for (const [id, pattern] of rules) if (pattern.test(text)) return id;
  return null;
}

export function genreLabel(id) {
  return BY_ID.get(id)?.label || null;
}
