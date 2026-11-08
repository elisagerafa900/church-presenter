// Online Bibles from YouVersion, shown in the Bible menu next to the built-in ones.
// Settings (App Key + chosen versions) stay on this PC. Verse text is kept in memory only.
import { resolveBook } from '../shared/bibleImport.js';
import { versesFromDoc, attributionText } from '../shared/yvHtml.js';
import { BOOKS } from '../shared/bibleRef.js';

const api = window.presenter;
const CODES = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'];

const read = (k, d) => { try { const s = localStorage.getItem(`cp.${k}`); return s ? JSON.parse(s) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(`cp.${k}`, JSON.stringify(v)); } catch { /* ignore */ } };

export const yvConfig = {
  key: () => read('yvKey', ''),
  setKey: (k) => write('yvKey', k),
  versions: () => read('yvVersions', []), // [{id:'YV111', yvId, abbreviation, title, attribution, offline}]
  setVersions: (v) => write('yvVersions', v),
};

export const isYouVersion = (id) => /^YV\d+$/.test(id);

const unwrap = (r) => { if (!r?.ok) throw new Error(r?.error || 'YouVersion error'); return r.data; };

export async function listYvVersions(key, lang) {
  return unwrap(await api.yvVersions(key, lang));
}

/** Builds a Bible object whose verses are fetched a chapter at a time. */
export async function loadYouVersionBible(id) {
  if (!api?.yvIndex) throw new Error('Online Bibles work in the desktop app.');
  const key = yvConfig.key();
  const meta = yvConfig.versions().find((v) => v.id === id);
  if (!meta) throw new Error(`${id} is not set up — add it in Bible → Add Bible → YouVersion.`);
  const index = unwrap(await api.yvIndex(key, meta.yvId, !!meta.offline));
  const books = Array.from({ length: 66 }, () => ({ chapters: [] }));
  for (const b of index.books || []) {
    const bi = resolveBook(b.id);
    if (bi < 0) continue;
    for (const ch of b.chapters || []) {
      const c = parseInt(ch.id, 10);
      if (!c) continue;
      const nums = (ch.verses || []).map((v) => parseInt(v.id, 10)).filter(Boolean);
      const count = nums.length ? Math.max(...nums) : 0;
      books[bi].chapters[c - 1] = new Array(count).fill(null);
    }
    for (let i = 0; i < books[bi].chapters.length; i++) if (!books[bi].chapters[i]) books[bi].chapters[i] = [];
  }
  const inflight = new Map();
  const bible = {
    id,
    name: meta.title,
    books,
    remote: { yvId: meta.yvId, attribution: meta.attribution, abbreviation: meta.abbreviation, offline: !!meta.offline, fromCache: !!index.fromCache },
    isLoaded(b, c) {
      const ch = books[b]?.chapters[c - 1];
      return !!ch && (ch.length === 0 || ch.loaded === true);
    },
    /** Fetch one chapter (once). Resolves when its verses are filled in. */
    ensureChapter(b, c) {
      const ch = books[b]?.chapters[c - 1];
      if (!ch || ch.loaded) return Promise.resolve();
      const k = `${b}.${c}`;
      if (!inflight.has(k)) {
        const p = api.yvChapter(key, meta.yvId, `${CODES[b]}.${c}`, !!meta.offline).then(unwrap).then((html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const verses = versesFromDoc(doc);
          for (let v = 1; v <= ch.length; v++) ch[v - 1] = verses.get(v) || '';
          for (const [n, t] of verses) if (n > ch.length) ch[n - 1] = t;
          ch.loaded = true;
        }).finally(() => inflight.delete(k));
        inflight.set(k, p);
      }
      return inflight.get(k);
    },
  };
  return bible;
}

export { attributionText, BOOKS };
