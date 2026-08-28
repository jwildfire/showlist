/**
 * End-to-end smoke test: serves the site, walks the demo → build → save path
 * with Spotify's API stubbed, and fails on any console error.
 *
 *   npm i -g playwright && node tests/smoke.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const TOP_TRACKS = (artist) => ({
  tracks: [1, 2, 3, 4, 5].map((n) => ({
    id: `${artist}-${n}`,
    uri: `spotify:track:${artist}${n}`,
    name: `Song ${n}`,
    album: { name: 'An Album', images: [{ url: '' }] },
    duration_ms: 200000,
    popularity: 90 - n,
    external_urls: { spotify: 'https://open.spotify.com/track/x' },
  })),
});

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));

  const added = [];
  await page.route('https://api.spotify.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/v1/search')) {
      await route.fulfill(
        json({ artists: { items: [{ id: 'a1', name: 'Match', popularity: 70, images: [], external_urls: {} }] } })
      );
    } else if (url.includes('/top-tracks')) {
      await route.fulfill(json(TOP_TRACKS(url.split('/artists/')[1].split('/')[0])));
    } else if (url.includes('/users/') && url.endsWith('/playlists')) {
      await route.fulfill(
        json({ id: 'pl1', external_urls: { spotify: 'https://open.spotify.com/playlist/pl1' } })
      );
    } else if (url.includes('/playlists/') && url.endsWith('/tracks')) {
      added.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill(json({ snapshot_id: 's1' }));
    } else {
      await route.fulfill(json({ id: 'me', display_name: 'Tester', country: 'US' }));
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      'showlist:spotify',
      JSON.stringify({
        clientId: 'test',
        accessToken: 'fake',
        refreshToken: 'fake-refresh',
        expiresAt: Date.now() + 3600000,
        profile: { id: 'me', name: 'Tester', market: 'US' },
      })
    );
  });

  await page.goto(base);
  const steps = [];

  // 0. The default path: preloaded listings, no keys, no settings touched.
  assert((await page.inputValue('#source')) === 'local', 'preloaded listings should be the default');
  await page.waitForFunction(() =>
    [...document.getElementById('source').options].some((o) => /preloaded/.test(o.textContent))
  );
  const sourceLabel = await page.locator('#source option[value=local]').textContent();
  assert(/Durham, NC \(preloaded\)/.test(sourceLabel), `source option reads "${sourceLabel}"`);
  await page.click('#find');
  await page.waitForSelector('.show');
  const preloaded = await page.locator('.show').count();
  assert(preloaded > 3, `expected preloaded shows in the default window, saw ${preloaded}`);
  const note = await page.locator('#showsNote').textContent();
  assert(/swept/i.test(note), `expected a sweep-date note, got "${note}"`);
  steps.push(`preloaded path returned ${preloaded} real shows with no keys`);

  // 1. Demo scan.
  await page.selectOption('#source', 'demo');
  await page.selectOption('#when', '30');
  await page.click('#find');
  await page.waitForSelector('.show');
  const shows = await page.locator('.show').count();
  assert(shows > 5, `expected a demo lineup, saw ${shows} shows`);
  steps.push(`found ${shows} demo shows`);

  // 2. Genre filter narrows the results.
  await page.click('button.genre-chip:has-text("Folk")');
  await page.click('#find');
  await page.waitForFunction((prev) => document.querySelectorAll('.show').length < prev, shows);
  const folk = await page.locator('.show').count();
  assert(folk > 0 && folk < shows, `folk filter should narrow ${shows} shows, got ${folk}`);
  steps.push(`genre filter narrowed to ${folk}`);
  await page.click('button.genre-chip:has-text("All genres")');
  await page.click('#find');
  await page.waitForFunction((n) => document.querySelectorAll('.show').length === n, shows);

  // 3. Dropping a show drops its artist from the playlist.
  await page.locator('.show input[type=checkbox]').first().uncheck();
  assert((await page.locator('#showCount').textContent()).startsWith(String(shows - 1)), 'kept count should drop');

  // 4. Build against the stubbed Spotify.
  await page.click('#build');
  await page.waitForSelector('.track');
  const tracks = await page.locator('.track').count();
  assert(tracks === (shows - 1) * 3, `expected 3 tracks for each of ${shows - 1} artists, got ${tracks}`);
  steps.push(`built ${tracks} tracks (3 per artist)`);

  // 5. Save, and check what we'd actually POST.
  await page.click('#saveSpotify');
  await page.waitForSelector('#playlistLinks a');
  const link = await page.locator('#playlistLinks a').getAttribute('href');
  assert(link.includes('open.spotify.com/playlist/pl1'), `unexpected playlist link ${link}`);
  const uris = added.flatMap((body) => body.uris || []);
  assert(uris.length === tracks, `posted ${uris.length} uris for ${tracks} tracks`);
  steps.push(`saved ${uris.length} uris to Spotify`);

  // 5b. Compact mode is on by default, roughly halves each row, and sticks.
  assert(await page.locator('body.compact').count(), 'compact should be the default');
  const rowHeight = async () => (await page.locator('.track').first().boundingBox()).height;
  const compactHeight = await rowHeight();
  await page.click('#compactToggle');
  const roomyHeight = await rowHeight();
  assert(
    compactHeight < roomyHeight * 0.7,
    `compact row ${compactHeight}px vs roomy ${roomyHeight}px — not much of a saving`
  );
  await page.click('#compactToggle');
  steps.push(`compact rows ${compactHeight}px vs roomy ${roomyHeight}px`);

  // 6. Settings survive a reload.
  await page.reload();
  await page.waitForSelector('#find');
  assert((await page.inputValue('#source')) === 'demo', 'source should persist');
  assert(await page.locator('body.compact').count(), 'compact preference should persist');
  steps.push('settings persisted across reload');

  // 7. Mobile layout doesn't overflow sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  assert(overflow <= 1, `page scrolls horizontally by ${overflow}px at 390px wide`);
  steps.push('no horizontal overflow at 390px');

  // 8. The keyless path: nothing connected, songs from the public catalogue.
  const clean = await browser.newContext();
  const anon = await clean.newPage();
  anon.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  anon.on('pageerror', (err) => errors.push(String(err)));
  await anon.route('https://itunes.apple.com/**', async (route) => {
    const term = new URL(route.request().url()).searchParams.get('term');
    await route.fulfill(
      json({
        resultCount: 3,
        results: [1, 2, 3].map((n) => ({
          kind: 'song',
          trackId: `${term}-${n}`,
          trackName: `Track ${n}`,
          artistName: term,
          collectionName: 'An Album',
          trackViewUrl: 'https://music.apple.com/x',
          previewUrl: 'https://audio.example/x.m4a',
        })),
      })
    );
  });
  await anon.goto(base);
  await anon.selectOption('#source', 'demo');
  await anon.selectOption('#when', '30');
  await anon.click('#find');
  await anon.waitForSelector('.show');
  const anonShows = await anon.locator('.show').count();
  await anon.click('#build');
  await anon.waitForSelector('.track');
  const anonTracks = await anon.locator('.track').count();
  assert(
    anonTracks === anonShows * 3,
    `keyless build made ${anonTracks} tracks for ${anonShows} shows`
  );
  const ytHref = await anon.locator('.track-links a').first().getAttribute('href');
  assert(/youtube\.com\/results\?search_query=/.test(ytHref), `bad YouTube link ${ytHref}`);
  assert(await anon.locator('#saveSpotify').isDisabled(), 'Spotify save should be off when not connected');
  assert(!(await anon.locator('#copyLinks').isDisabled()), 'Copy links should work with no account');
  steps.push(`keyless path built ${anonTracks} tracks with search links, no login`);

  // 9. The built-in client ID is actually used, and the authorize request is
  //    shaped the way Spotify (and the app's registered redirect URI) needs.
  const fresh = await browser.newContext();
  const connect = await fresh.newPage();
  let authorizeUrl = null;
  await connect.route('https://accounts.spotify.com/**', async (route) => {
    authorizeUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' });
  });
  await connect.goto(base);
  await connect.click('#setupBtn');
  await connect.click('#connectSpotify');
  await connect.waitForFunction(() => !document.querySelector('#setupDialog[open]') || true);
  await connect.waitForTimeout(600);
  assert(authorizeUrl, 'Connect Spotify should send you to accounts.spotify.com');
  const auth = new URL(authorizeUrl);
  const expect = {
    client_id: 'bc3960b18f1e4d77a05439653fb1b732',
    response_type: 'code',
    code_challenge_method: 'S256',
  };
  for (const [key, value] of Object.entries(expect)) {
    assert(auth.searchParams.get(key) === value, `${key} was "${auth.searchParams.get(key)}"`);
  }
  assert(auth.searchParams.get('redirect_uri') === base, `redirect_uri was ${auth.searchParams.get('redirect_uri')}`);
  assert((auth.searchParams.get('code_challenge') || '').length >= 43, 'missing PKCE challenge');
  assert(
    (auth.searchParams.get('scope') || '').includes('playlist-modify-private'),
    'missing the playlist scope'
  );
  steps.push('Connect Spotify uses the built-in client ID with a valid PKCE challenge');

  // 10. When Spotify itself refuses, the build falls back instead of dying —
  //     and says which error caused it.
  const broken = await browser.newContext();
  const failing = await broken.newPage();
  failing.on('pageerror', (err) => errors.push(String(err)));
  await failing.addInitScript(() => {
    localStorage.setItem(
      'showlist:spotify',
      JSON.stringify({
        clientId: 'test',
        accessToken: 'fake',
        refreshToken: 'fake-refresh',
        expiresAt: Date.now() + 3600000,
        profile: { id: 'me', name: 'Tester', market: 'US' },
      })
    );
  });
  await failing.route('https://api.spotify.com/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/v1/me')) {
      await route.fulfill(json({ id: 'me', display_name: 'Tester', country: 'US' }));
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { status: 403, message: 'Forbidden' } }),
    });
  });
  await failing.route('https://itunes.apple.com/**', async (route) => {
    const term = new URL(route.request().url()).searchParams.get('term');
    await route.fulfill(
      json({
        results: [1, 2, 3].map((n) => ({
          kind: 'song',
          trackId: `${term}-${n}`,
          trackName: `Fallback ${n}`,
          artistName: term,
          trackViewUrl: 'https://music.apple.com/x',
        })),
      })
    );
  });
  await failing.goto(base);
  await failing.selectOption('#source', 'demo');
  await failing.click('#find');
  await failing.waitForSelector('.show');
  await failing.click('#build');
  await failing.waitForSelector('.track');
  const fallbackTracks = await failing.locator('.track').count();
  assert(fallbackTracks > 0, 'a Spotify outage should not leave an empty playlist');
  const banner = await failing.locator('#errorText').textContent();
  assert(
    /Spotify/.test(banner) && /403/.test(banner) && /development mode/.test(banner),
    `banner should name the cause, got "${banner}"`
  );
  assert(
    await failing.locator('#saveSpotify').isDisabled(),
    'fallback tracks have no Spotify ids, so saving there must stay off'
  );
  steps.push(`Spotify 403 fell back to ${fallbackTracks} catalogue tracks, cause reported`);

  // 11. Development-mode reality: /artists/{id}/top-tracks is 403 but /search
  //     works, so the build should still produce saveable Spotify tracks.
  const devMode = await browser.newContext();
  const dev = await devMode.newPage();
  dev.on('pageerror', (err) => errors.push(String(err)));
  await dev.addInitScript(() => {
    localStorage.setItem(
      'showlist:spotify',
      JSON.stringify({
        clientId: 'test',
        accessToken: 'fake',
        refreshToken: 'fake-refresh',
        expiresAt: Date.now() + 3600000,
        profile: { id: 'me', name: 'Tester', market: 'US' },
      })
    );
  });

  let topTrackCalls = 0;
  const devAdded = [];
  await dev.route('https://api.spotify.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/top-tracks')) {
      topTrackCalls++;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { status: 403, message: 'Forbidden' } }),
      });
    } else if (url.includes('type=artist')) {
      await route.fulfill(
        json({ artists: { items: [{ id: 'a1', name: 'Khruangbin', popularity: 70, images: [], external_urls: {} }] } })
      );
    } else if (url.includes('type=track')) {
      const params = new URL(url).searchParams;
      const limit = Number(params.get('limit') || 20);
      assert(limit <= 20, `track search asked for limit=${limit}; Spotify rejects large limits`);
      assert(!/[:"]/.test(params.get('q') || ''), `track search should stay a plain keyword query, got ${params.get('q')}`);
      await route.fulfill(
        json({
          tracks: {
            items: [
              // Deliberately out of order, with a duplicate and a wrong artist.
              { id: 't2', uri: 'spotify:track:t2', name: 'Second', popularity: 50, artists: [{ name: 'Khruangbin' }], album: { images: [] }, external_urls: {} },
              { id: 't1', uri: 'spotify:track:t1', name: 'First', popularity: 90, artists: [{ name: 'Khruangbin' }], album: { images: [] }, external_urls: {} },
              { id: 't1b', uri: 'spotify:track:t1b', name: 'first', popularity: 80, artists: [{ name: 'Khruangbin' }], album: { images: [] }, external_urls: {} },
              { id: 'x', uri: 'spotify:track:x', name: 'Not Theirs', popularity: 99, artists: [{ name: 'Someone Else' }], album: { images: [] }, external_urls: {} },
              { id: 't3', uri: 'spotify:track:t3', name: 'Third', popularity: 10, artists: [{ name: 'Khruangbin' }], album: { images: [] }, external_urls: {} },
            ],
          },
        })
      );
    } else if (url.includes('/users/') && url.endsWith('/playlists')) {
      await route.fulfill(json({ id: 'pl2', external_urls: { spotify: 'https://open.spotify.com/playlist/pl2' } }));
    } else if (url.includes('/playlists/') && url.endsWith('/tracks')) {
      devAdded.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill(json({ snapshot_id: 's1' }));
    } else {
      await route.fulfill(json({ id: 'me', display_name: 'Tester', country: 'US' }));
    }
  });

  await dev.goto(base);
  await dev.selectOption('#source', 'demo');
  await dev.click('#find');
  await dev.waitForSelector('.show');
  await dev.locator('.show input[type=checkbox]').nth(0).check();
  // Keep one show so the assertions are about ordering, not volume.
  await dev.click('#selectNone');
  await dev.locator('.show input[type=checkbox]').first().check();
  await dev.click('#build');
  await dev.waitForSelector('.track');

  const titles = await dev.locator('.track-title').allTextContents();
  assert(titles.length === 3, `expected 3 tracks, got ${titles.length}: ${titles}`);
  assert(titles[0] === 'First', `popularity should rank first, got ${titles[0]}`);
  assert(!titles.includes('Not Theirs'), 'another artist’s track leaked in');
  assert(titles.filter((t) => t.toLowerCase() === 'first').length === 1, 'duplicate reissue not collapsed');
  assert(topTrackCalls === 1, `top-tracks should be tried once then abandoned, tried ${topTrackCalls}`);

  assert(!(await dev.locator('#saveSpotify').isDisabled()), 'search-sourced tracks must be saveable');
  await dev.click('#saveSpotify');
  await dev.waitForSelector('#playlistLinks a');
  assert(devAdded.flatMap((b) => b.uris || []).length === 3, 'should post 3 uris');
  steps.push('403 on top-tracks falls through to search, still saveable to Spotify');

  await browser.close();
  server.close();

  if (errors.length) {
    console.error('Console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('PASS\n' + steps.map((s) => '  ✓ ' + s).join('\n'));
}

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
