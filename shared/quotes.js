// Finds verses the preacher QUOTES without naming them ("for God so loved the world…").
// Works offline: an index of distinctive word pairs from every verse in every loaded Bible.
// Score = how much of a verse's distinctive wording was just spoken.

const STOP_PAIR_SHARE = 0.004; // word pairs in more than 0.4% of verses ("of the", "and he") don't count

// Spoken / modern forms -> one spelling, so KJV, BSB and speech line up
const SAME = {
  thee: 'you', thou: 'you', ye: 'you', thy: 'your', thine: 'your', hath: 'has', doth: 'does',
  saith: 'says', unto: 'to', shalt: 'shall', wilt: 'will', art: 'are', hast: 'have', didst: 'did',
  spake: 'spoke', cometh: 'comes', goeth: 'goes', loveth: 'loves', believeth: 'believes',
  shewed: 'showed', shew: 'show', labour: 'labor', honour: 'honor', saviour: 'savior',
};

export function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SAME[w] || w);
}

function pairs(words) {
  const out = new Set();
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

export class QuoteIndex {
  /** Build without freezing the screen (yields between books). */
  static async create(bibles) {
    const idx = new QuoteIndex(null);
    const steps = idx._steps(bibles);
    for (let r = steps.next(); !r.done; r = steps.next()) await new Promise((res) => setTimeout(res, 0));
    return idx;
  }

  /** bibles: array of {id, books:[{chapters:[[text]]}]} — pass null when using create() */
  constructor(bibles) {
    if (!bibles) return;
    const steps = this._steps(bibles);
    while (!steps.next().done) { /* build all at once (tests) */ }
  }

  *_steps(bibles) {
    this.refs = []; // verse number -> {book, chapter, verse}
    this.refIndex = new Map(); // "b.c.v" -> verse number
    const postings = new Map(); // pair -> Set(verse number)
    const versePairs = [];
    for (const bible of bibles) {
      for (let bi = 0; bi < bible.books.length; bi++) {
        bible.books[bi].chapters.forEach((ch, ci) =>
          ch.forEach((text, vi) => {
            const key = `${bi}.${ci + 1}.${vi + 1}`;
            let n = this.refIndex.get(key);
            if (n === undefined) {
              n = this.refs.length;
              this.refs.push({ book: bi, chapter: ci + 1, verse: vi + 1 });
              this.refIndex.set(key, n);
              versePairs[n] = [];
            }
            const ps = pairs(tokens(text));
            versePairs[n].push(ps);
            for (const p of ps) {
              let s = postings.get(p);
              if (!s) postings.set(p, (s = new Set()));
              s.add(n);
            }
          }),
        );
        yield;
      }
    }
    const N = this.refs.length;
    this.weight = new Map();
    for (const [p, s] of postings) {
      if (s.size / N > STOP_PAIR_SHARE) continue; // too common to mean anything
      this.weight.set(p, Math.log(N / s.size));
    }
    yield;
    this.postings = new Map();
    for (const [p, s] of postings) if (this.weight.has(p)) this.postings.set(p, [...s]);
    yield;
    this.verseTotals = [];
    for (let n = 0; n < versePairs.length; n++) {
      this.verseTotals[n] = versePairs[n].map((ps) => {
        let t = 0;
        const kept = [];
        for (const p of ps) {
          const w = this.weight.get(p);
          if (w) { t += w; kept.push(p); }
        }
        return { total: t, pairs: new Set(kept) };
      });
      if (n % 3000 === 0) yield;
    }
  }

  /** Best matching verses for some spoken text, best first (max k). */
  matchAll(text, k = 3) {
    const qp = pairs(tokens(text));
    const cand = new Map();
    for (const p of qp) {
      const list = this.postings.get(p);
      if (!list || list.length > 400) continue;
      for (const n of list) cand.set(n, (cand.get(n) || 0) + 1);
    }
    const out = [];
    for (const [n, hits] of cand) {
      if (hits < 3) continue;
      let best = null;
      for (const v of this.verseTotals[n]) {
        if (!v.total) continue;
        let got = 0;
        let count = 0;
        for (const p of v.pairs) if (qp.has(p)) { got += this.weight.get(p); count += 1; }
        const coverage = got / v.total;
        const score = coverage * Math.min(1, count / 5); // short matches count less
        if (!best || score > best.score) best = { ref: this.refs[n], coverage, matchedPairs: count, score };
      }
      if (best) out.push(best);
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, k);
  }

  /** How well some text matches one particular verse (same score as matchAll). */
  scoreRef(text, ref) {
    const n = this.refIndex.get(`${ref.book}.${ref.chapter}.${ref.verse}`);
    if (n === undefined) return 0;
    const qp = pairs(tokens(text));
    let best = 0;
    for (const v of this.verseTotals[n]) {
      if (!v.total) continue;
      let got = 0;
      let count = 0;
      for (const p of v.pairs) if (qp.has(p)) { got += this.weight.get(p); count += 1; }
      best = Math.max(best, (got / v.total) * Math.min(1, count / 5));
    }
    return best;
  }

  /** Best matching verse for some spoken text, or null. */
  match(text) {
    return this.matchAll(text, 1)[0] || null;
  }
}

/** Confidence 0-89 like a meaning match (direct references stay 90+). */
export const QUOTE_MIN_CONFIDENCE = 50;
export function quoteConfidence(m) {
  if (!m) return 0;
  return Math.round(Math.min(89, 40 + 60 * m.score));
}
