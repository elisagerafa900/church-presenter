// Finds scriptures in the live sermon transcript.
// 1. Direct references ("John three sixteen", "turn to Romans 8", "verse 17") — 75–95%
// 2. Quoted verses without a reference ("for God so loved the world…") — 50–89%
import { findReferences, formatRef } from './bibleRef.js';
import { quoteConfidence, QUOTE_MIN_CONFIDENCE } from './quotes.js';

export class ScriptureDetector {
  constructor(books, { repeatMs = 45000 } = {}) {
    this.books = books;
    this.repeatMs = repeatMs;
    this.context = null; // last book/chapter, so "verse 17" works
    this.prevTail = '';
    this.lastSeen = new Map(); // ref key -> time
    this.quoteIndex = null;
    this.window = []; // last words spoken, for quote matching
  }

  /** Turn on quote matching (a QuoteIndex built from the Bibles). */
  setQuoteIndex(index) {
    this.quoteIndex = index;
  }

  /** Call when the operator shows a verse, so "verse 17" follows what's on screen. */
  setContext(ref) {
    if (ref) this.context = { book: ref.book, chapter: ref.chapter };
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
      this.lastSeen.set(key, now);
      this.context = { book: r.book, chapter: r.chapter };
      out.push({
        id: `${key}@${now}`,
        ref: { book: r.book, chapter: r.chapter, verse: r.verse ?? 1 },
        endVerse: r.endVerse ?? null,
        label: key,
        heard: r.text,
        kind: r.fromContext ? 'context' : r.verse ? 'verse' : 'chapter',
        confidence: r.fromContext ? 75 : r.verse ? 95 : 85,
        at: now,
      });
    }

    // Quoted verses: look at roughly the last 40 words
    const words = text.trim().split(/\s+/);
    this.window = [...this.window, ...words].slice(-40);
    if (out.length) this.window = [];
    if (this.quoteIndex && out.length === 0) {
      for (const m of this.quoteIndex.matchAll(this.window.join(' '), 3)) {
        const confidence = quoteConfidence(m);
        if (confidence < QUOTE_MIN_CONFIDENCE) break;
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
