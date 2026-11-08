// Run: node shared/detector.test.js
import { readFileSync } from 'node:fs';
import { ScriptureDetector } from './detector.js';
import { QuoteIndex } from './quotes.js';

const books = JSON.parse(readFileSync(new URL('../public/bibles/KJV.json', import.meta.url))).books;
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};

// A sermon, the way Deepgram sends finished pieces (smart_format on/off mixed)
const d = new ScriptureDetector(books);
let t = 0;
const feed = (s) => d.feed(s, (t += 5000)).map((x) => `${x.label}|${x.confidence}`);
eq('no ref', feed('Praise the Lord, church. Somebody say amen.'), []);
eq('direct', feed('Turn with me to John 3:16.'), ['John 3:16|95']);
eq('repeat ignored', feed('John 3:16 says for God so loved the world'), []);
eq('context verse', feed('And verse 17 says, for God sent not his Son'), ['John 3:17|75']);
eq('split across pieces', [...feed('Now open your Bibles to Romans'), ...feed('chapter eight verse twenty eight')], ['Romans 8:28|95']);
eq('chapter only', feed('We are reading Hebrews chapter eleven this morning'), ['Hebrews 11|85']);
eq('spoken numbers', feed('first Corinthians thirteen verse four to seven'), ['1 Corinthians 13:4-7|95']);
eq('psalm', feed('Psalm one hundred and nineteen verse one hundred and five'), ['Psalms 119:105|95']);
eq('name not ref', feed('Mark my words, James is coming'), []);
// After the repeat window, the same verse can be detected again
t += 60000;
eq('repeat after window', feed('Again, John 3:16'), ['John 3:16|95']);
// Context from operator
const d2 = new ScriptureDetector(books);
d2.setContext({ book: 18, chapter: 23 });
eq('operator context', d2.feed('verse four, yea though I walk', 1).map((x) => x.label), ['Psalms 23:4']);

// Quoted verses (no reference said)
const load = (id) => JSON.parse(readFileSync(new URL(`../public/bibles/${id}.json`, import.meta.url)));
const qi = new QuoteIndex(['KJV', 'BSB', 'ASV'].map(load));
const d3 = new ScriptureDetector(books);
d3.setQuoteIndex(qi);
let t3 = 0;
const q = (s) => d3.feed(s, (t3 += 4000)).map((x) => `${x.label}|${x.kind}`);
eq('quote: normal talk', q('Good morning church, God is good all the time. Let us pray.'), []);
eq('quote: John 3:16 across pieces', [...q('the Bible says for God so loved the world'), ...q('that he gave his only begotten son that whosoever believeth in him')], ['John 3:16|quote']);
eq('quote: continuation is not a new verse', [...q('The word of God says for God so loved the world'), ...q('that he gave his only begotten son that whosoever believeth in him should not perish.')].filter((x) => x !== 'John 3:16|quote'), []);
eq('quote: next verse', q('for God sent not his Son into the world to condemn the world but that the world through him might be saved'), ['John 3:17|quote']);
eq('quote: Philippians', q('I can do all things through Christ which strengtheneth me'), ['Philippians 4:13|quote']);
eq('quote: modern wording', q('trust in the Lord with all your heart and lean not on your own understanding'), ['Proverbs 3:5|quote']);
eq('quote: testimony talk', q('when I was in Lagos last week I met a brother who told me his testimony'), []);
eq('direct ref wins', q('Isaiah 40 verse 31 they that wait upon the Lord shall renew their strength'), ['Isaiah 40:31|verse']);
// Async build gives the same index
const qa = await QuoteIndex.create(['KJV'].map(load));
eq('async build', qa.match('in the beginning God created the heaven and the earth')?.ref, { book: 0, chapter: 1, verse: 1 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
