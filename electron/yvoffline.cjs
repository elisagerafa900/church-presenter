// Offline-copy rules for YouVersion Bibles (used by main.cjs; testable on its own).
// Chapters: saved copy first, internet second. Index: internet first (that re-checks
// the licence), saved copy only when there is no internet.
module.exports = function makeYvOffline(yv, cache) {
  const licenceLost = (e) => e?.code === 401 || e?.code === 403;
  const jobs = new Map(); // yvId -> { cancel }

  async function index(key, id, offline) {
    try {
      const idx = await yv.getIndex(key, id);
      if (offline && cache.available()) { cache.put(id, 'index', JSON.stringify(idx)); cache.markVerified(id); }
      return idx;
    } catch (e) {
      if (licenceLost(e)) cache.clear(id);
      if (offline && e.code === 'NETWORK') {
        const saved = cache.get(id, 'index');
        if (saved) return { ...JSON.parse(saved), fromCache: true };
      }
      throw e;
    }
  }

  async function chapter(key, id, usfm, offline) {
    if (offline) {
      const saved = cache.get(id, usfm);
      if (saved !== null) return saved;
    }
    try {
      const html = await yv.getChapterHtml(key, id, usfm);
      if (offline && cache.available() && !cache.expired(id)) cache.put(id, usfm, html);
      return html;
    } catch (e) {
      if (licenceLost(e)) cache.clear(id);
      if (e.code === 'NETWORK') {
        e.message = offline
          ? 'No internet, and this chapter is not saved offline yet.'
          : 'No internet — online Bibles need a connection (or switch on "Keep an offline copy").';
      }
      throw e;
    }
  }

  async function downloadAll(key, id, report = () => {}, { pauseMs = 120, workers = 3 } = {}) {
    id = Number(id);
    if (!cache.available()) throw new Error('Secure storage is not available on this PC, so offline copies are off.');
    if (jobs.has(id)) throw new Error('Already downloading.');
    const job = { cancel: false };
    jobs.set(id, job);
    try {
      const idx = await index(key, id, true);
      const all = [];
      for (const b of idx.books || []) for (const ch of b.chapters || []) {
        const u = `${b.id}.${ch.id}`;
        if (/^[1-3A-Z]{3}\.\d+$/.test(u)) all.push(u);
      }
      const todo = all.filter((u) => !cache.has(id, u));
      let done = all.length - todo.length;
      let failed = 0;
      const tell = () => report({ yvId: id, done, total: all.length });
      tell();
      let lost = null;
      const work = async () => {
        while (todo.length && !job.cancel && !lost) {
          const usfm = todo.shift();
          try {
            cache.put(id, usfm, await yv.getChapterHtml(key, id, usfm));
          } catch (e) {
            if (licenceLost(e)) { cache.clear(id); lost = e; break; }
            failed += 1;
          }
          done += 1;
          if (done % 5 === 0 || !todo.length) tell();
          if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs)); // be gentle with YouVersion
        }
      };
      await Promise.all(Array.from({ length: workers }, work));
      if (lost) throw lost;
      tell();
      return { cancelled: job.cancel, failed, ...cache.stats(id) };
    } finally {
      jobs.delete(id);
    }
  }

  const cancel = (id) => { const j = jobs.get(Number(id)); if (j) j.cancel = true; };

  return { index, chapter, downloadAll, cancel };
};
