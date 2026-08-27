// Sample data so the app is explorable (and testable) with no keys at all.
// Shows are generated relative to today around whatever place is selected.

const LINEUP = [
  { artist: 'Khruangbin', genre: 'rock', venue: 'Stubb’s Waller Creek', dayOffset: 2, mi: 3 },
  { artist: 'Big Thief', genre: 'alternative', venue: 'Scoot Inn', dayOffset: 3, mi: 5 },
  { artist: 'Turnstile', genre: 'metal', venue: 'Emo’s', dayOffset: 4, mi: 7 },
  { artist: 'Jamila Woods', genre: 'rnb', venue: 'Antone’s', dayOffset: 5, mi: 2 },
  { artist: 'Fontaines D.C.', genre: 'alternative', venue: 'ACL Live', dayOffset: 6, mi: 1 },
  { artist: 'Jason Isbell', genre: 'folk', venue: 'Paramount Theatre', dayOffset: 8, mi: 1 },
  { artist: 'Fred again..', genre: 'electronic', venue: 'Germania Insurance Amphitheater', dayOffset: 9, mi: 12 },
  { artist: 'Sierra Ferrell', genre: 'country', venue: 'Moody Amphitheater', dayOffset: 10, mi: 2 },
  { artist: 'Vampire Weekend', genre: 'rock', venue: 'Moody Center', dayOffset: 12, mi: 3 },
  { artist: 'Little Simz', genre: 'hiphop', venue: 'Concourse Project', dayOffset: 13, mi: 8 },
  { artist: 'Julien Baker', genre: 'alternative', venue: 'Mohawk', dayOffset: 15, mi: 2 },
  { artist: 'Kamasi Washington', genre: 'jazz', venue: 'The Long Center', dayOffset: 17, mi: 2 },
  { artist: 'Hurray for the Riff Raff', genre: 'folk', venue: 'Central Presbyterian', dayOffset: 19, mi: 1 },
  { artist: 'Peso Pluma', genre: 'latin', venue: 'H-E-B Center', dayOffset: 22, mi: 22 },
  { artist: 'Caribou', genre: 'electronic', venue: 'Empire Control Room', dayOffset: 24, mi: 3 },
  { artist: 'Waxahatchee', genre: 'folk', venue: 'Scoot Inn', dayOffset: 27, mi: 5 },
  { artist: 'Denzel Curry', genre: 'hiphop', venue: 'Emo’s', dayOffset: 31, mi: 7 },
  { artist: 'boygenius', genre: 'alternative', venue: 'Moody Center', dayOffset: 38, mi: 3 },
];

export const meta = {
  id: 'demo',
  label: 'Demo data',
  needs: null,
  blurb: 'A fake but realistic week of shows. No keys needed — good for a first look.',
};

export async function findShows({ place, radius, start, end, genres }) {
  const origin = place || { label: 'Austin, TX', lat: 30.2672, lon: -97.7431 };
  const wanted = new Set(genres || []);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const shows = LINEUP.map((row, i) => {
    const when = new Date(today);
    when.setDate(when.getDate() + row.dayOffset);
    when.setHours(19 + (i % 3), i % 2 ? 30 : 0, 0, 0);
    // Scatter venues around the origin, roughly `mi` miles out.
    const bearing = (i * 137.5 * Math.PI) / 180;
    return {
      id: `demo:${i}`,
      source: 'demo',
      name: `${row.artist} at ${row.venue}`,
      start: when,
      dateTBA: false,
      artists: [{ name: row.artist, spotifyId: null }],
      venue: {
        name: row.venue,
        city: origin.label.split(',')[0],
        state: '',
        lat: origin.lat + (row.mi / 69) * Math.cos(bearing),
        lon: origin.lon + (row.mi / 55) * Math.sin(bearing),
      },
      url: '',
      image: '',
      genre: row.genre,
      distanceMi: row.mi,
    };
  }).filter(
    (show) =>
      show.start >= start &&
      show.start <= end &&
      show.distanceMi <= radius &&
      (!wanted.size || wanted.has(show.genre))
  );

  return { shows, truncated: false, total: shows.length };
}
