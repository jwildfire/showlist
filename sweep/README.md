# The weekly sweep

`data/shows.json` is a checked-in list of real, upcoming shows for one metro
area. It's what makes the site work with **no API key at all** — the listings
ship with the page.

A scheduled Claude Code session refreshes it once a week. This file is the spec
that run follows; you can also just ask Claude Code to "refresh the sweep" by
hand.

## Procedure

1. Read `data/shows.json`. Keep `area` and the `venues` list — those are the
   sweep's territory (venue names, cities, coordinates, calendar URLs).
2. For each venue, run a web search like
   `"<venue name>" <city> <month> <year> concert schedule lineup`, covering
   **today through about ten weeks out**. Two searches per venue is normal:
   one per month at the edges of the window.
3. Record a show **only** when the result gives you all three of: at least one
   artist name, a specific date, and the venue. Anything vaguer gets dropped —
   a date with no artist is useless to a playlist, and a guessed artist is
   worse than a missing one.
4. Drop shows that have already happened. Keep everything still upcoming, even
   if it was in the previous file.
5. Fill each record in:

   ```json
   {
     "id": "cats-cradle-2026-10-05-36",
     "artists": ["Black Country, New Road"],
     "start": "2026-10-05T20:00:00-04:00",
     "timeUnknown": false,
     "genre": "alternative",
     "venue": { "name": "Cat's Cradle", "city": "Carrboro", "state": "NC",
                "lat": 35.9101, "lon": -79.0753 },
     "url": "https://catscradle.com/events/"
   }
   ```

   - `start` is local time with the correct UTC offset (`-04:00` in EDT,
     `-05:00` after the November change). Unknown door time → use `20:00` and
     set `"timeUnknown": true`.
   - `genre` must be one of the ids in `js/genres.js`, or omitted.
   - `url` points at the venue's own calendar — link people to the source, not
     to a resale site.
   - Skip non-music bookings: comedy, touring musicals, film scores, festivals
     with no named lineup. They add nothing to a playlist.
6. Set `generatedAt` to now, in UTC.
7. Run the validator and fix anything it flags:

   ```bash
   node sweep/validate.mjs
   ```

8. Commit with a message like `sweep: 53 shows through Oct 24` and push to
   `main`.

## Rules

- **Never invent a show.** If the search results are thin, a short file is the
  correct outcome. Say so in the commit message.
- **Never guess coordinates for a new venue** — look them up, and keep them
  inside the `area.radiusMi` circle. The validator enforces the radius.
- Artist names should be spelled the way the artist spells them, so Spotify
  can match them: `Black Country, New Road`, not `Black Country New Road`.

## Changing the territory

Edit `area` (label, lat/lon, radius) and the `venues` list in
`data/shows.json`. The next sweep follows whatever is in that file — the
schedule and the code don't hard-code any city.
