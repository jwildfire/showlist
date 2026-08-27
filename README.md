# Showlist

**Find out who's playing near you in the next couple of weeks, and turn that lineup into a playlist.**

Pick a place, a radius, a date window and some genres. Showlist scans concert
listings, collapses the lineup down to the artists playing, pulls each one's
best-known tracks, and saves the result as a playlist in your Spotify or
YouTube account.

**▶ Live: <https://jwildfire.github.io/showlist/>**

It's a static site — no server, no database, no accounts. Everything runs in
your browser, and your keys and tokens never leave it.

---

## Quick start

1. **Look around with demo data.** Open the site, set *Listings from* to
   **Demo data**, hit **Find shows**. No keys, no sign-in.
2. **Add a Ticketmaster key** (2 minutes, free) to scan real listings near you.
3. **Connect Spotify** to turn a lineup into a real playlist.

Then it's one button: **⚡ Just do it for me** — your location, the next 14
days, every genre, top 3 tracks per artist, playlist built and waiting to be
saved.

## What you need, and why

The site has no backend to keep secrets in, so it uses *your* credentials,
stored in your own browser's local storage. Every field is optional; fill in
what you want to use.

### Ticketmaster API key — for finding shows

1. Register at
   [developer-acct.ticketmaster.com](https://developer-acct.ticketmaster.com/user/register).
2. Your default app appears immediately under **My Apps**.
3. Copy the **Consumer Key** into Showlist's Setup panel.

Free tier: 5 requests/second, 5,000 requests/day. A scan costs 1–3 requests.

### Spotify client ID — for songs and playlists

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard)
   and **Create app**.
2. Name it anything. Tick **Web API**.
3. Under **Redirect URIs**, paste the URI shown in Showlist's Setup panel —
   exactly, including the trailing slash. For the deployed site that's
   `https://jwildfire.github.io/showlist/`.
4. Copy the **Client ID** into Setup. **Leave the client secret alone** —
   Showlist uses PKCE, which doesn't need one.

Showlist asks for permission to read your top artists and to create playlists.
It never modifies playlists it didn't create.

### Google OAuth client ID — for YouTube (optional)

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project and enable the **YouTube Data API v3**.
2. Configure the OAuth consent screen (External is fine) and add yourself as a
   test user.
3. Create an **OAuth client ID** of type **Web application**, with
   `https://jwildfire.github.io` as an *Authorized JavaScript origin*.
4. Copy the client ID into Setup.

Mind the quota: the default allowance is 10,000 units/day, and each track
match costs a 100-unit search plus a 50-unit insert. That's roughly 60 songs a
day. Showlist tells you the estimated cost before spending it.

### Bandsintown app id — for the watchlist source (optional)

Request one at
[artists.bandsintown.com](https://artists.bandsintown.com/support/api-installation).

## The two listing sources

|                    | Ticketmaster                                        | Bandsintown                                                    |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| **Question it answers** | "What's playing within N miles of me?"         | "Where is *this artist* playing?"                              |
| **How Showlist uses it** | Scans every listed music event in your radius | Checks a watchlist of artists for dates that land near you     |
| **Best at**        | Clubs, halls, arenas, festivals — broad coverage      | Small rooms and DIY shows Ticketmaster never lists             |
| **Genre filters**  | Yes                                                  | No — its listings carry no genre tags                          |

Bandsintown's public API is artist-oriented, so that mode needs a watchlist.
Type names in, or press **Import from my Spotify** to seed it from your top and
followed artists.

## How a playlist gets built

```
location + radius + dates + genres
        │
        ├─ Ticketmaster events search  ─┐
        └─ Bandsintown per-artist dates ┤
                                        ▼
                              shows (you can uncheck any)
                                        ▼
                     artists, deduped across nights, soonest first
                                        ▼
              Spotify artist match → top 3 tracks   (or YouTube search)
                                        ▼
                   playlist → Spotify · YouTube · clipboard · JSON
```

Artists are deduped case- and punctuation-insensitively, so a band playing
three nights contributes one set of tracks. The playlist is ordered by show
date, so the soonest shows are at the top.

## Privacy

- Keys, tokens and settings live in `localStorage` / `sessionStorage` in your
  browser, under the `showlist:` prefix.
- Requests go directly from your browser to Ticketmaster, Bandsintown, Spotify,
  YouTube, and the two keyless geocoders (Open-Meteo, Zippopotam).
- There is no analytics, no logging, and nowhere for data to be collected —
  the site is a folder of static files on GitHub Pages.
- **Forget everything on this device** in Setup clears all of it and revokes the
  YouTube token.

## Development

No build step, no dependencies. Edit the files and reload.

```bash
python3 -m http.server 8000    # or: npx serve .
```

Tests:

```bash
node --test tests/unit.test.mjs   # pure logic: dates, geo, genres, playlist assembly
node tests/smoke.cjs              # browser walkthrough (needs: npm i -g playwright)
```

The smoke test serves the site, runs the demo → build → save path with the
Spotify API stubbed, and fails on any console error or horizontal overflow.

### Layout

```
index.html            markup and the setup dialog
styles.css            one dark theme, CSS custom properties
js/app.js             wiring: controls → source → artists → tracks → playlist
js/ui.js              DOM rendering
js/state.js           localStorage: keys, controls, watchlist
js/geo.js             geolocation, geocoding, distance, geohash
js/dates.js           date-range presets and per-API date formats
js/genres.js          one genre vocabulary, mapped per source
js/playlist.js        shows → artists → ordered tracklist
js/sources/*.js       ticketmaster, bandsintown, demo
js/music/*.js         spotify (PKCE), youtube (Google Identity Services)
```

Adding a service means writing one module with `resolveTracks` and
`createPlaylist`; adding a listing source means one module exporting `meta` and
`findShows` that returns shows in the shared shape. Both are registered in one
line in `js/app.js`.

## Deploying your own copy

1. Fork or clone this repo.
2. **Settings → Pages → Build and deployment → Deploy from a branch →
   `main` / `/ (root)`**.
3. Register your Pages URL as the Spotify redirect URI and the Google
   JavaScript origin, as above.

## License

MIT — see [LICENSE](LICENSE).
