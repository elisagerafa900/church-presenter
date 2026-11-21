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

// Early detection while the words are still coming in
const d5 = new ScriptureDetector(books);
let t5 = 0;
const early = (s) => d5.feedInterim(s, (t5 += 700)).map((x) => x.label);
eq('early: book only', early('so let us look at Luke'), []);
eq('early: number still coming', early('so let us look at Luke twenty four verse forty'), []);
eq('early: complete once next word arrives', early('so let us look at Luke twenty four verse forty seven Luke'), ['Luke 24:47']);
eq('early: not again from interim', early('so let us look at Luke twenty four verse forty seven Luke 24 47'), []);
eq('early: not again when final arrives', d5.feed('So let us look at Luke 24:47. Luke 24:47.', (t5 += 700)).map((x) => x.label), []);
eq('early: misheard Acts', early('it says X1 vis4. He says'), ['Acts 1:4']);
eq('early: Malachi mid-sentence', early('you see that thing in Malachi 3:3 he will sit'), ['Malachi 3:3']);
eq('early: chapter only waits', early('turn with me to Hebrews eleven and'), []);
eq('early: colon form', early('look at Exodus 4:10 I never knew'), ['Exodus 4:10']);
eq('early: 2 Corinthians', early('2 Corinthians 12 verse 7. Just one more'), ['2 Corinthians 12:7']);
eq('early: James', early('look at James 1:2. Are you'), ['James 1:2']);

// Misheard repeats (real sermon: "Luke 24 verse 47. Luke 24 verse 7.")
const d6 = new ScriptureDetector(books);
let t6 = 0;
const f6 = (s) => d6.feed(s, (t6 += 3000)).map((x) => `${x.label}|${x.confidence}`);
eq('repeat: first one', f6("So let's look at it. Luke 24 verse 47."), ['Luke 24:47|95']);
eq('repeat: misheard second is doubtful', f6('Luke 24 verse 7. We are going to read up to the end of it.'), ['Luke 24:7|70']);
eq('repeat: next verse by number still works', f6('Verse 48. And ye are witnesses'), ['Luke 24:48|75']);
eq('repeat: chapter said again is ignored', f6("and then we'll read Luke 24 again"), []);
t6 += 20000;
eq('repeat: another verse later is fine', f6('Now Luke 24 verse 49.'), ['Luke 24:49|95']);
const d7 = new ScriptureDetector(books);
let t7 = 0;
eq('repeat: early skips doubtful', [d7.feedInterim('now look at Acts 1 verse 4. Acts', (t7 += 700)).map((x) => x.label), d7.feedInterim('now look at Acts 1 verse 4. Acts 1 verse 1. And being', (t7 += 2000)).map((x) => x.label)], [['Acts 1:4'], []]);
eq('repeat: other book right after is fine', d7.feed('Compare Luke 24 verse 49', (t7 += 2000)).map((x) => x.label), ['Luke 24:49']);

// Colon dropped by the speech engine
const d8 = new ScriptureDetector(books);
let t8 = 0;
const f8 = (s) => new ScriptureDetector(books).feed(s, (t8 += 60000)).map((x) => `${x.label}|${x.confidence}`);
eq('split: Malachi 33', f8('You see that thing in Malachi 33, he will sit as a refiner'), ['Malachi 3:3|90']);
eq('split: John 316', f8('John 316 says for God so loved'), ['John 3:16|90']);
eq('split: Luke 2447', f8('look at Luke 2447'), ['Luke 24:47|90']);
eq('split: real chapter stays', f8('Psalm 119 is long'), ['Psalms 119|85']);
eq('split: ambiguous is ignored', f8('Genesis 123 is'), []);
eq('split: Malachi 3.3 (dot)', f8('He wants to purify you. You see that in Malachi 3.3, he will sit as a refiner of silver'), ['Malachi 3:3|95']);
eq('split: early Malachi 3.3', new ScriptureDetector(books).feedInterim('You see that in Malachi 3.3, he will sit', 1).map((x) => x.label), ['Malachi 3:3']);
eq('split: early Malachi 33', d8.feedInterim('the thing in Malachi 33 he will sit', (t8 += 60000)).map((x) => `${x.label}|${x.confidence}`), ['Malachi 3:3|90']);

// Following along: "next verse" and "verse 8" while a verse is on screen (real sermon lines)
const d9 = new ScriptureDetector(books);
let t9 = 0;
const f9 = (s) => d9.feed(s, (t9 += 6000)).map((x) => `${x.label}|${x.confidence}`);
d9.setContext({ book: 43, chapter: 7, verse: 23 }, t9); // Acts 7:23 on screen
eq('next: next verse', f9('Moses. Next verse. And seeing one of them suffer wrong, he defended him'), ['Acts 7:24|90']);
eq('next: again goes one further', f9('struck down the Egyptian. Next verse.'), ['Acts 7:25|90']);
eq('next: plain talk', f9('For he supposed that his brethren would have understood'), []);
d9.setContext({ book: 58, chapter: 1, verse: 2 }, t9); // operator shows James 1:2
eq('verse N: on screen chapter goes up', f9('Now, you know this same James, look at verse 13.'), ['James 1:13|90']);
d9.setContext({ book: 58, chapter: 1, verse: 13 }, t9);
eq('verse N: go to verse three', f9('Let no one say when he is tempted. Now go to verse three. He says'), ['James 1:3|90']);
d9.setContext({ book: 58, chapter: 1, verse: 3 }, t9);
eq('next: twice in one breath counts once', f9('Next verse, next verse.'), ['James 1:4|90']);
const d10 = new ScriptureDetector(books);
eq('next: nothing on screen', d10.feed('Next verse.', 1).map((x) => x.label), []);
d10.setContext({ book: 64, chapter: 1, verse: 25 }, 1); // Jude 1:25, last verse
eq('next: past the end', d10.feed('Next verse.', 5000).map((x) => x.label), []);
d10.setContext({ book: 42, chapter: 3, verse: 16 }, 0);
eq('verse N: stale screen is 75', d10.feed('look at verse 17', 10 * 60000).map((x) => `${x.label}|${x.confidence}`), ['John 3:17|75']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
