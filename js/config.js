// Site-wide defaults, committed to the repo.
//
// OAuth *client IDs* are public identifiers, not secrets — they name the app,
// not you, and both flows this site uses (Spotify PKCE, Google Identity
// Services) are designed to ship them in client-side code. Putting yours here
// means anyone opening the site just clicks "Connect Spotify" and logs in:
// no key to paste, and it follows you to your phone.
//
// Anything a visitor types into the Setup panel overrides these.
//
// Spotify: developer.spotify.com/dashboard → Create app → tick Web API → add
//   this site's URL as a Redirect URI → copy the Client ID (never the secret).
// Google: console.cloud.google.com → enable YouTube Data API v3 → OAuth client
//   ID → Web application → add this site's origin as a JavaScript origin.
export const CONFIG = {
  spotifyClientId: 'bc3960b18f1e4d77a05439653fb1b732',
  googleClientId: '',
};
