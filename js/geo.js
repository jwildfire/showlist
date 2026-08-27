// Location helpers: browser geolocation, keyless geocoding, distance, geohash.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Encode a lat/lon as a geohash string (Ticketmaster's `geoPoint` format). */
export function geohash(lat, lon, precision = 7) {
  let latMin = -90,
    latMax = 90,
    lonMin = -180,
    lonMax = 180;
  let hash = '';
  let bits = 0;
  let bit = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        bits = (bits << 1) + 1;
        lonMin = mid;
      } else {
        bits = bits << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bits = (bits << 1) + 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[bits];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

const EARTH_RADIUS_MI = 3958.8;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in miles. */
export function milesBetween(a, b) {
  if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return Infinity;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True for a US ZIP, with or without the +4 suffix. */
export function looksLikeZip(text) {
  return /^\s*\d{5}(-\d{4})?\s*$/.test(text || '');
}

/**
 * Turn free text into a place. US ZIPs go through Zippopotam, everything else
 * through Open-Meteo's geocoder. Both are keyless and CORS-enabled.
 */
export async function geocode(query) {
  const text = (query || '').trim();
  if (!text) throw new Error('Enter a city or ZIP code first.');

  if (looksLikeZip(text)) {
    const zip = text.slice(0, 5);
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) throw new Error(`No US ZIP code matching "${zip}".`);
    const body = await res.json();
    const place = body.places?.[0];
    if (!place) throw new Error(`No US ZIP code matching "${zip}".`);
    return {
      label: `${place['place name']}, ${place['state abbreviation']} ${zip}`,
      lat: Number(place.latitude),
      lon: Number(place.longitude),
      countryCode: 'US',
      postalCode: zip,
    };
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', text);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding service is unavailable right now.');
  const body = await res.json();
  const hit = body.results?.[0];
  if (!hit) throw new Error(`Couldn't find a place called "${text}".`);
  return {
    label: [hit.name, hit.admin1, hit.country_code === 'US' ? null : hit.country]
      .filter(Boolean)
      .join(', '),
    lat: hit.latitude,
    lon: hit.longitude,
    countryCode: hit.country_code || '',
  };
}

/** Reverse-geocode a fix from the browser into something with a name. */
export async function describeCoords(lat, lon) {
  const fallback = { label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, countryCode: '' };
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('localityLanguage', 'en');
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const body = await res.json();
    const label = [body.city || body.locality, body.principalSubdivisionCode?.split('-').pop()]
      .filter(Boolean)
      .join(', ');
    return label ? { label, lat, lon, countryCode: body.countryCode || '' } : fallback;
  } catch {
    return fallback;
  }
}

/** Ask the browser where we are. Resolves to the same shape as `geocode`. */
export function locateMe(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser has no location support — type a city or ZIP instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(describeCoords(pos.coords.latitude, pos.coords.longitude)),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission denied — type a city or ZIP instead.'
              : "Couldn't get your location — type a city or ZIP instead."
          )
        ),
      { timeout: 10000, maximumAge: 300000, ...options }
    );
  });
}
