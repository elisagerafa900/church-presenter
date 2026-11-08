import { BOOKS } from '../shared/bibleRef.js';

export const TRANSLATIONS = [
  { id: 'KJV', name: 'King James Version' },
  { id: 'BSB', name: 'Berean Standard Bible' },
  { id: 'ASV', name: 'American Standard Version' },
];

const cache = new Map();

export function loadBible(id) {
  if (!cache.has(id)) {
    cache.set(
      id,
      fetch(`./bibles/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${id}`);
        return r.json();
      }),
    );
  }
  return cache.get(id);
}

export function verseText(bible, ref) {
  return bible?.books[ref.book]?.chapters[ref.chapter - 1]?.[ref.verse - 1] ?? '';
}

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
