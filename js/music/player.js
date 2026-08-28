// Spotify's embed player. It needs no token and no app permissions — the
// restriction that blocks playlist writes doesn't apply here. Anyone gets
// 30-second previews; a viewer logged into Spotify Premium in the same browser
// gets whole tracks.
//
// Docs: https://developer.spotify.com/documentation/embeds/references/iframe-api

const SRC = 'https://open.spotify.com/embed/iframe-api/v1';

let controller = null;
let loading = null;
let queue = [];
let index = 0;
let advancing = false;
let onChange = null;

/** Load the iFrame API once and build a controller inside `container`. */
function ensureController(container, uri) {
  if (controller) return Promise.resolve(controller);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Spotify player took too long to load.')),
      15000
    );

    window.onSpotifyIframeApiReady = (api) => {
      api.createController(container, { uri, width: '100%', height: 80 }, (made) => {
        clearTimeout(timer);
        controller = made;
        made.addListener?.('playback_update', (event) => onPlaybackUpdate(event?.data));
        resolve(made);
      });
    };

    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      loading = null;
      reject(new Error('Spotify player could not load — check your connection or ad blocker.'));
    };
    document.head.appendChild(script);
  });

  return loading;
}

/** Roll onto the next track when the current one runs out. */
function onPlaybackUpdate(data) {
  if (!data || advancing) return;
  const { position, duration } = data;
  if (!duration || position < duration - 1200) return;
  advancing = true;
  setTimeout(() => {
    advancing = false;
    if (index + 1 < queue.length) playAt(index + 1);
  }, 400);
}

export function setQueue(uris) {
  queue = uris.filter(Boolean);
  index = 0;
}

export function queueLength() {
  return queue.length;
}

export function onTrackChange(handler) {
  onChange = handler;
}

/** Play queue position `i`, building the player on first use. */
export async function playAt(i, container) {
  if (!queue.length) throw new Error('Nothing to play yet.');
  index = Math.max(0, Math.min(i, queue.length - 1));
  const uri = queue[index];

  if (!controller) {
    if (!container) throw new Error('No player container.');
    container.hidden = false;
    await ensureController(container, uri);
  } else {
    controller.loadUri(uri);
  }
  controller.play?.();
  onChange?.(index);
  return index;
}

export function stop() {
  controller?.pause?.();
}

export function isReady() {
  return Boolean(controller);
}
