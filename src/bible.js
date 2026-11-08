import { BOOKS } from '../shared/bibleRef.js';
import { isYouVersion, loadYouVersionBible } from './youversion.js';

// Built into the app (all public domain)
export const TRANSLATIONS = [
  { id: 'KJV', name: 'King James Version' },
  { id: 'WEB', name: 'World English Bible (LORD edition)' },
  { id: 'BSB', name: 'Berean Standard Bible' },
  { id: 'ASV', name: 'American Standard Version' },
];
export const BUILTIN_IDS = new Set(TRANSLATIONS.map((t) => t.id));

const cache = new Map();

export function loadBible(id) {
  if (!cache.has(id)) {
    const p = isYouVersion(id)
      ? loadYouVersionBible(id)
      : BUILTIN_IDS.has(id)
      ? fetch(`./bibles/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${id}`);
        return r.json();
      })
      : window.presenter?.biblesRead
        ? window.presenter.biblesRead(id).then((t) => JSON.parse(t))
        : Promise.reject(new Error(`${id} is not available`));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return cache.get(id);
}

export function forgetBible(id) {
  cache.delete(id);
}

/** Bibles the church imported (stored on this PC). */
export async function importedBibles() {
  try {
    return (await window.presenter?.biblesList?.()) || [];
  } catch {
    return [];
  }
}

export function verseText(bible, ref) {
  return bible?.books[ref.book]?.chapters[ref.chapter - 1]?.[ref.verse - 1] ?? '';
} // online Bibles: '' until the chapter has been fetched

export function refLabel(ref) {
  return `${BOOKS[ref.book]} ${ref.chapter}:${ref.verse}`;
}

export function sameRef(a, b) {
  return !!a && !!b && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;
}

/** Keyword search: every word must appear. Returns up to `limit` hits. */
export function searchText(bible, query, limit = 100) {
  const words = query.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  if (!words.length || !bible) return [];
  const phrase = words.join(' ');
  const hits = [];
  bible.books.forEach((b, bi) =>
    b.chapters.forEach((ch, ci) =>
      ch.forEach((t, vi) => {
        const lt = t.toLowerCase();
        if (words.every((w) => lt.includes(w))) {
          hits.push({ ref: { book: bi, chapter: ci + 1, verse: vi + 1 }, text: t, exact: lt.includes(phrase) });
        }
      }),
    ),
  );
  hits.sort((a, b) => b.exact - a.exact);
  return hits.slice(0, limit);
}
