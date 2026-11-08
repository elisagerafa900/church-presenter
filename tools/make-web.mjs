// Builds public/bibles/WEB.json from the public-domain World English Bible (USFX)
// and gives it the familiar "LORD" wording instead of "Yahweh".
// Source: https://github.com/seven1m/open-bibles (eng-web.usfx.xml)
// Run: node tools/make-web.mjs path/to/eng-web.usfx.xml
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBibleFile } from '../shared/bibleImport.js';

export function lordEdition(t) {
  let s = t;
  s = s.replace(/\bLord Yahweh\b/g, 'Lord GOD');
  s = s.replace(/\bYahweh(’s|'s)/g, 'the LORD$1');
  s = s.replace(/\bO Yahweh\b/g, 'O LORD');
  s = s.replace(/\bYahweh\b/g, 'the LORD');
  s = s.replace(/\bO Yah\b/g, 'O LORD');
  s = s.replace(/\bYah\b/g, 'the LORD');
  s = s.replace(/\bthe the LORD\b/g, 'the LORD');
  // Capital "The" at the start of a sentence or quote
  s = s.replace(/(^|[.!?]\s+|[“"‘(]\s*)the LORD/g, (_, pre) => `${pre}The LORD`);
  return s;
}

if (process.argv[2]) {
  const xml = readFileSync(process.argv[2], 'utf8');
  const { books, stats } = parseBibleFile(xml, 'web.xml');
  // Match KJV verse numbering: WEB prints Romans 16:25-27 after Romans 14:23
  const rom = books[44].chapters;
  if (rom[13].length === 26 && rom[15].length === 24) rom[15].push(...rom[13].splice(23, 3));
  // Verses WEB leaves out of its main text (kept in footnotes)
  const NOTE = '[Not included in this translation]';
  for (const b of books) for (const ch of b.chapters) for (let i = 0; i < ch.length; i++) if (!ch[i]) ch[i] = NOTE;
  const out = { id: 'WEB', name: 'World English Bible (LORD edition)', books: books.map((b) => ({ chapters: b.chapters.map((ch) => ch.map(lordEdition)) })) };
  writeFileSync(new URL('../public/bibles/WEB.json', import.meta.url), JSON.stringify(out));
  console.log('WEB written:', stats);
}
