// Finds scriptures in the live sermon transcript.
// 1. Direct references ("John three sixteen", "turn to Romans 8", "verse 17") — 75–95%
// 2. Quoted verses without a reference ("for God so loved the world…") — 50–89%
import { findReferences, formatRef } from './bibleRef.js';
import { quoteConfidence, QUOTE_MIN_CONFIDENCE } from './quotes.js';

const REPEAT_WINDOW_MS = 15000;
const SCREEN_FRESH_MS = 5 * 60000;
// "next verse", "the following verse", "next scripture", "verse after that"
const NEXT_RE = /\b(?:next|following)\s+(?:verse|versus|scripture)\b|\bverse after (?:that|this)\b/;
const DOUBTFUL_REPEAT_CONFIDENCE = 70;

export class ScriptureDetector {
  constructor(books, { repeatMs = 45000 } = {}) {
    this.books = books;
    this.repeatMs = repeatMs;
    this.context = null; // last book/chapter, so "verse 17" works
    this.prevTail = '';
    this.lastSeen = new Map(); // ref key -> time
    this.quoteIndex = null;
    this.window = []; // last words spoken, for quote matching
    this.quoteMin = QUOTE_MIN_CONFIDENCE;
    this.lastDirect = null;
    this.onScreen = null; // what the operator (or auto-present) last put on screen
    this.lastNextAt = 0; // last book+chapter+verse said in full, for catching misheard repeats
  }

  /**
   * Preachers repeat a reference ("Luke 24:47, Luke 24:47") and the second time the speech engine
   * can mishear the number ("Luke 24 verse 7"). A different verse of the same chapter, said in full
   * within a few seconds, is most likely that: keep it in the list but never put it on screen by itself.
   * Saying just the chapter again ("Acts 1") right after a verse in it is not a new scripture at all.
   */
  _repeatCheck(r, now) {
    const l = this.lastDirect;
    if (!l || r.fromContext || r.book !== l.book || r.chapter !== l.chapter) return 'new';
    if (r.verse === null || r.verse === undefined) return now - l.at < 60000 ? 'skip' : 'new';
    if (r.verse !== l.verse && now - l.at < REPEAT_WINDOW_MS) return 'doubtful';
    return 'new';
  }

  /** Lowest confidence worth reporting for quoted verses (the operator's auto-present level can go lower). */
  setMinConfidence(n) {
    this.quoteMin = Math.max(30, Math.min(QUOTE_MIN_CONFIDENCE, Number(n) || QUOTE_MIN_CONFIDENCE));
  }

  /** Turn on quote matching (a QuoteIndex built from the Bibles). */
  setQuoteIndex(index) {
    this.quoteIndex = index;
  }

  /** Call when the operator shows a verse, so "verse 17" follows what's on screen. */
  setContext(ref, now = Date.now()) {
    if (!ref) return;
    this.context = { book: ref.book, chapter: ref.chapter };
    if (ref.verse) this.onScreen = { book: ref.book, chapter: ref.chapter, verse: ref.endVerse || ref.verse, at: now };
  }

  /** "Verse 8" while a verse of that chapter is on screen is almost surely that chapter. */
  _contextConfidence(r, now) {
    const o = this._screen(now);
    return o && o.book === r.book && o.chapter === r.chapter ? 90 : 75;
  }

  /** The verse on screen, if it was put there in the last few minutes. */
  _screen(now) {
    const o = this.onScreen;
    return o && now - o.at < SCREEN_FRESH_MS ? o : null;
  }

  /** "Next verse" / "the following verse": one step on from what's on screen. */
  _nextVerse(text, now) {
    if (!NEXT_RE.test(text.toLowerCase())) return null;
    if (now - this.lastNextAt < 3000) return null; // same words seen twice
    const o = this._screen(now);
    if (!o) return null;
    const verses = this.books?.[o.book]?.chapters?.[o.chapter - 1];
    if (!verses || o.verse + 1 > verses.length) return null;
    this.lastNextAt = now;
    const ref = { book: o.book, chapter: o.chapter, verse: o.verse + 1 };
    this.onScreen = { ...ref, at: now }; // a second "next verse" goes one further
    this.context = { book: ref.book, chapter: ref.chapter };
    const key = formatRef(ref);
    this.lastSeen.set(key, now);
    return { id: `${key}@${now}`, ref, endVerse: null, label: key, heard: 'next verse', kind: 'next', confidence: 90, at: now };
  }

  /**
   * Feed the words being spoken right now (not finished yet). Returns detections only for
   * references that are complete: the same reference is still found without the last word,
   * so "Luke 24 verse forty…" never shows 24:40 before "…seven" arrives.
   * Only direct references with a verse count here; chapters and quotes wait for the finished text.
   */
  feedInterim(text, now = Date.now()) {
    if (!text || !text.trim() || text === '…') return [];
    const joined = `${this.prevTail} ${text}`.trim();
    const words = joined.split(/\s+/);
    if (words.length < 3) return [];
    const opts = { spoken: true, books: this.books, context: null };
    const full = findReferences(joined, opts).filter((r) => r.verse !== null);
    if (!full.length) return [];
    const shorter = new Set(findReferences(words.slice(0, -1).join(' '), opts).filter((r) => r.verse !== null).map(formatRef));
    const out = [];
    for (const r of full) {
      const key = formatRef(r);
      if (!shorter.has(key)) continue; // still being said
      const seen = this.lastSeen.get(key);
      if (seen && now - seen < this.repeatMs) continue;
      if (this._repeatCheck(r, now) !== 'new') continue; // let the finished text decide
      this.lastSeen.set(key, now);
      this.lastDirect = { book: r.book, chapter: r.chapter, verse: r.verse, at: now };
      this.context = { book: r.book, chapter: r.chapter };
      out.push({
        id: `${key}@${now}`,
        ref: { book: r.book, chapter: r.chapter, verse: r.verse },
        endVerse: r.endVerse ?? null,
        label: key,
        heard: r.text,
        kind: 'verse',
        confidence: r.split ? 90 : 95,
        early: true,
        at: now,
      });
    }
    return out;
  }

  /** Feed one finished piece of transcript. Returns new detections (newest last). */
  feed(text, now = Date.now()) {
    if (!text || !text.trim()) return [];
    // Keep a few words from the previous piece: "…open to John" + "chapter 3 verse 16".
    const joined = `${this.prevTail} ${text}`.trim();
    this.prevTail = text.trim().split(/\s+/).slice(-6).join(' ');
    const refs = findReferences(joined, { spoken: true, books: this.books, context: this.context });
    const out = [];
    for (const r of refs) {
      const key = formatRef(r);
      const seen = this.lastSeen.get(key);
      if (seen && now - seen < this.repeatMs) continue;
      const check = this._repeatCheck(r, now);
      if (check === 'skip') continue;
      this.lastSeen.set(key, now);
      if (check === 'new') {
        this.context = { book: r.book, chapter: r.chapter };
        if (r.verse && !r.fromContext) this.lastDirect = { book: r.book, chapter: r.chapter, verse: r.verse, at: now };
      }
      out.push({
        id: `${key}@${now}`,
        ref: { book: r.book, chapter: r.chapter, verse: r.verse ?? 1 },
        endVerse: r.endVerse ?? null,
        label: key,
        heard: r.text,
        kind: r.fromContext ? 'context' : r.verse ? 'verse' : 'chapter',
        confidence: check === 'doubtful' ? DOUBTFUL_REPEAT_CONFIDENCE : r.fromContext ? this._contextConfidence(r, now) : r.split ? 90 : r.verse ? 95 : 85,
        ...(check === 'doubtful' ? { note: 'maybe misheard repeat' } : {}),
        at: now,
      });
    }

    // "next verse" — only in the new words, so the copy kept in the tail never counts twice
    if (!out.length) {
      const nx = this._nextVerse(text, now);
      if (nx) out.push(nx);
    }

    // Quoted verses: look at roughly the last 40 words
    const words = text.trim().split(/\s+/);
    this.window = [...this.window, ...words].slice(-40);
    if (out.length) this.window = [];
    if (this.quoteIndex && out.length === 0) {
      for (const m of this.quoteIndex.matchAll(this.window.join(' '), 3)) {
        const confidence = quoteConfidence(m);
        if (confidence < this.quoteMin) break;
        const key = formatRef(m.ref);
        const seen = this.lastSeen.get(key);
        // Best match is the verse we just found: the preacher is still reading it.
        if (seen && now - seen < this.repeatMs) break;
        // Words that fit the previous quoted verse at least as well are its continuation
        // ("…for God so loved the world" | "…whosoever believeth in him should not perish").
        const lq = this.lastQuote;
        if (lq && now - lq.at < 30000 && this.quoteIndex.scoreRef(this.window.join(' '), lq.ref) >= m.score * 0.9) break;
        this.lastSeen.set(key, now);
        this.context = { book: m.ref.book, chapter: m.ref.chapter };
        out.push({
          id: `${key}@${now}`,
          ref: { ...m.ref },
          endVerse: null,
          label: key,
          heard: words.slice(-12).join(' '),
          kind: 'quote',
          confidence,
          at: now,
        });
        this.lastQuote = { ref: { ...m.ref }, at: now };
        this.window = []; // start fresh, so the same words don't also match a neighbouring verse
        break;
      }
    }
    return out;
  }
}
