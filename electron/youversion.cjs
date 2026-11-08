// YouVersion Platform API (https://platform.youversion.com) — online Bibles your App Key is licensed for.
// Runs in the main process. Each church uses its OWN App Key (never stored in the code).
// Verse text is fetched live; nothing is saved to disk (caching depends on each version's licence).
const API = process.env.YV_API_URL || 'https://api.youversion.com'; // override only for tests

function getFetch() {
  try {
    const { net } = require('electron');
    if (net?.fetch) return net.fetch.bind(net);
  } catch { /* plain node (tests) */ }
  return fetch;
}

function query(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else if (v !== undefined && v !== null) sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function yvGet(key, path, params) {
  if (!key) throw new Error('Add your YouVersion App Key first.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await getFetch()(`${API}${path}${query(params)}`, {
      headers: { 'X-YVP-App-Key': key, Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'YouVersion did not answer (check the internet).' : `Could not reach YouVersion: ${e.message}`);
    err.code = 'NETWORK';
    throw err;
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const code = res.status;
    const msg =
      code === 401 ? 'YouVersion rejected the App Key. Check it in Bible → Add Bible → YouVersion.'
      : code === 403 ? 'Your App Key is not licensed for this Bible version.'
      : code === 404 ? 'YouVersion could not find that passage or version.'
      : code === 429 ? 'Too many requests to YouVersion — wait a moment.'
      : `YouVersion error ${code}.`;
    const err = new Error(msg);
    err.code = code >= 500 || code === 429 ? 'NETWORK' : code; // server trouble counts like no internet
    throw err;
  }
  return res.json();
}

/** Versions available to this key for a language (e.g. "en"). */
async function listVersions(key, language = 'en') {
  const out = [];
  let token = null;
  for (let page = 0; page < 10; page++) {
    const params = { 'language_ranges[]': [language], page_size: 100 };
    if (token) params.page_token = token;
    const r = await yvGet(key, '/v1/bibles', params);
    for (const v of r.data || []) {
      out.push({
        yvId: v.id,
        abbreviation: v.localized_abbreviation || v.abbreviation,
        title: v.localized_title || v.title,
        copyright: v.copyright || '',
        promo: v.promotional_content || '',
        language: v.language_tag,
      });
    }
    token = r.next_page_token;
    if (!token) break;
  }
  return out;
}

const getVersion = (key, id) => yvGet(key, `/v1/bibles/${Number(id)}`);
const getIndex = (key, id) => yvGet(key, `/v1/bibles/${Number(id)}/index`);

/** Raw passage HTML for e.g. "JHN.3" (whole chapter). */
async function getChapterHtml(key, id, usfm) {
  if (!/^[1-3A-Z]{3}\.\d+$/.test(usfm)) throw new Error('Bad chapter reference');
  const r = await yvGet(key, `/v1/bibles/${Number(id)}/passages/${usfm}`, { format: 'html', include_headings: false, include_notes: false });
  return r.content || '';
}

module.exports = { listVersions, getVersion, getIndex, getChapterHtml };
