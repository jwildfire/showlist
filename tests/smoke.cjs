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

  // 6. Settings survive a reload.
  await page.reload();
  await page.waitForSelector('#find');
  assert((await page.inputValue('#source')) === 'demo', 'source should persist');
  steps.push('settings persisted across reload');

  // 7. Mobile layout doesn't overflow sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  assert(overflow <= 1, `page scrolls horizontally by ${overflow}px at 390px wide`);
  steps.push('no horizontal overflow at 390px');

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
