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

## Two paths

**1. Preloaded — nothing to set up.** `data/shows.json` ships with the site: a
list of real upcoming shows for one metro area (currently **Durham, NC and
everything within 60 miles** — Raleigh, Chapel Hill, Carrboro, Cary,
Saxapahaw, Greensboro), refreshed by a [weekly sweep](sweep/README.md) of
public venue calendars. Open the site, hit **Find shows**, done. No key, no
rate limit.

**2. Anywhere else — bring a Ticketmaster key.** Free, about two minutes (see
below). Then any city or ZIP, any radius, live listings.

Either way you get a real tracklist with **nothing connected**: song titles
come from Apple's public iTunes Search API (keyless, no login), and every track
carries a YouTube and a Spotify search link that works for anybody. Connect
Spotify only when you want it *saved* as a playlist in your account. And there's one
button that does the whole thing: **⚡ Just do it for me** — next 14 days,
every genre, top 3 tracks per artist, playlist built and waiting to be saved.

## Quick start

1. **Open it and press Find shows.** The preloaded Triangle listings answer
   immediately.
2. **Connect Spotify** in Setup, press **Build playlist**, then **Save to
   Spotify**.
3. Only if you want another metro area: add a **Ticketmaster key** in Setup.

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
4. Copy the **Client ID**. Put it in `js/config.js` and commit it — client IDs
   are public identifiers, not secrets, and then the site is zero-setup on
   every device: visitors just press *Connect Spotify* and log in. (Pasting it
   into the Setup panel instead works too, but only for that one browser.)
   **Leave the client secret alone** — PKCE doesn't need one.

**Dashboard erroring?** It's a heavy single-page app and it fails fairly often
— usually transiently, and frequently because a tracking blocker or strict
privacy mode breaks it. Try an incognito window with extensions off, or come
back in a few hours. Meanwhile the site still works: build the playlist, press
**Copy list**, and paste the `Artist - Title` lines into an importer like
[Spotlistr](http://spotlistr.com) or [Soundiiz](https://soundiiz.com) — they
run their own registered apps, so you just log into Spotify there.

While your app is in Spotify's default *development mode*, only you and up to
25 accounts you add under **User Management** in the dashboard can log in.
That's normally plenty for a personal site; lifting it needs a quota-extension
request to Spotify.

Showlist asks for permission to read your top artists and to create playlists.
It never modifies playlists it didn't create.

### Google OAuth client ID — for YouTube (optional)

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project and enable the **YouTube Data API v3**.
2. Configure the OAuth consent screen (External is fine) and add yourself as a
   test user.
3. Create an **OAuth client ID** of type **Web application**, with
   `https://jwildfire.github.io` as an *Authorized JavaScript origin*.
4. Copy the client ID into `js/config.js` (or the Setup panel). Same story as
   Spotify: while the OAuth consent screen is in testing, only accounts you add
   as test users can authorize.

Mind the quota: the default allowance is 10,000 units/day, and each track
match costs a 100-unit search plus a 50-unit insert. That's roughly 60 songs a
day. Showlist tells you the estimated cost before spending it.

### Bandsintown app id — for the watchlist source (optional)

Request one at
[artists.bandsintown.com](https://artists.bandsintown.com/support/api-installation).

## The listing sources

| | Preloaded sweep |
| --- | --- |
| **Question it answers** | "What's playing near Durham in the next couple of months?" |
| **How Showlist uses it** | Reads `data/shows.json`, filters by your radius, dates and genres |
| **Needs** | Nothing |
| **Freshness** | Refreshed weekly; the app shows the sweep date |

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
        ├─ data/shows.json (preloaded)  ─┐
        ├─ Ticketmaster events search    │
        └─ Bandsintown per-artist dates ─┤
                                        ▼
                              shows (you can uncheck any)
                                        ▼
                     artists, deduped across nights, soonest first
                                        ▼
     Spotify top tracks (if connected)  ·  iTunes Search (if not)
                                        ▼
        playlist → Spotify · YouTube · search links · clipboard · JSON
```

Artists are deduped case- and punctuation-insensitively, so a band playing
three nights contributes one set of tracks. The playlist is ordered by show
date, so the soonest shows are at the top.

## Who can actually use a deployed copy

| | Who |
| --- | --- |
| **Browsing the preloaded listings** | Anyone. No login, no key, nothing to install. |
| **Building a tracklist** | Anyone — songs come from the keyless iTunes Search API. |
| **The per-track YouTube / Spotify links, and *Copy links*** | Anyone. They're just search URLs. |
| **Demo data** | Anyone. |
| **Ticketmaster / Bandsintown listings** | Anyone who brings their own key or app id. |
| **Saving to Spotify** | The app owner, plus up to **25 accounts** added under *User Management* in the Spotify dashboard. Anyone else can paste their own client ID in Setup and use their own app. |
| **Saving to YouTube** | The owner plus test users on the Google consent screen (up to 100) — and all of them share **one** 10,000-unit daily quota, roughly 60 songs a day in total. |

Only the two *save* rows are gated. Everything up to and including a finished,
clickable tracklist works for a stranger who has never heard of either
dashboard.

Those caps are the OAuth providers' rules for unverified apps, not something
this site imposes. Lifting Spotify's needs a quota-extension request; lifting
Google's needs a security assessment for the restricted YouTube scope. For a
personal site, staying inside them is normal.

If someone hits the Spotify cap, the app now says so explicitly rather than
reporting a generic sign-in failure.

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
node sweep/validate.mjs           # checks data/shows.json before it ships
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
js/sources/*.js       local (the preloaded sweep), ticketmaster, bandsintown, demo
data/shows.json       the swept listings, and the area + venues they cover
sweep/                the weekly refresh spec and its validator
js/music/*.js         spotify (PKCE), youtube (Google Identity Services),
                      itunes (keyless track lookup)
js/links.js           credential-free search URLs per track
```

Track lookup and playlist saving are separate concerns: `resolveTracks` picks
the songs (Spotify or iTunes), `createPlaylist` saves them (Spotify or
YouTube). Adding a service means writing one module with either half; adding a listing source means one module exporting `meta` and
`findShows` that returns shows in the shared shape. Both are registered in one
line in `js/app.js`.

## The weekly refresh

A scheduled Claude Code session runs the sweep every **Monday at 08:00 ET**,
following [sweep/README.md](sweep/README.md): it re-searches the venue
calendars, prunes shows that have happened, validates the file, and pushes.
The Pages deploy runs off that push, so the site is never more than a week
stale — and the app shows the sweep date above the results.

To change the cadence, or to stop it, edit the "Showlist weekly concert sweep"
routine in your Claude routines. To run it on demand, ask Claude Code to
"refresh the Showlist sweep".

## Sweeping a different area

Nothing about the city is hard-coded. Edit `area` (label, lat/lon, radius) and
the `venues` list in `data/shows.json`, then run the sweep again — see
[sweep/README.md](sweep/README.md). The source dropdown names itself after
whatever `area.label` says.

## Deploying your own copy

1. Fork or clone this repo.
2. **Settings → Pages → Build and deployment → Deploy from a branch →
   `main` / `/ (root)`**.
3. Register your Pages URL as the Spotify redirect URI and the Google
   JavaScript origin, as above.

## License

MIT — see [LICENSE](LICENSE).
