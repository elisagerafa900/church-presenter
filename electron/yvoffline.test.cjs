// Run: node electron/yvoffline.test.cjs  (offline-copy rules with a fake YouVersion + fake encryption)
// fake YouVersion + fake safeStorage -> offline rules
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const cache = require('./yvcache.cjs');
const makeOff = require('./yvoffline.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yvc-'));
const fakeSafe = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)), decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString() };
cache.setup(dir, fakeSafe);
let online = true, licensed = true, calls = 0;
const net = (fn) => async (...a) => { calls++; if (!online) { const e = new Error('offline'); e.code = 'NETWORK'; throw e; } if (!licensed) { const e = new Error('not licensed'); e.code = 403; throw e; } return fn(...a); };
const books = [{ id: 'JHN', chapters: [{ id: '1' }, { id: '2' }, { id: '3' }] }, { id: 'GEN', chapters: [{ id: 'INTRO' }, { id: '1' }] }];
const yv = { getIndex: net(async () => ({ books })), getChapterHtml: net(async (k, id, u) => `<p>${u} text</p>`) };
const off = makeOff(yv, cache);
let pass = 0, fail = 0; const eq = (n, g, w) => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.log('FAIL', n, JSON.stringify(g), '!=', JSON.stringify(w)); } };
(async () => {
  // offline copy OFF: nothing saved
  await off.index('K', 111, false); await off.chapter('K', 111, 'JHN.3', false);
  eq('off: nothing saved', cache.stats(111).chapters, 0);
  // ON: index verifies, chapter saved
  await off.index('K', 111, true); await off.chapter('K', 111, 'JHN.3', true);
  eq('on: chapter saved', cache.stats(111).chapters, 1);
  const raw = fs.readFileSync(path.join(dir, '111', 'JHN.3.bin'));
  eq('stored encrypted (not plain text)', raw.toString().includes('JHN.3 text'), false);
  // saved copy is used first (no network call)
  calls = 0; eq('cache-first', await off.chapter('K', 111, 'JHN.3', true), '<p>JHN.3 text</p>'); eq('no network used', calls, 0);
  // no internet: saved works, unsaved explains
  online = false;
  eq('offline: saved chapter', await off.chapter('K', 111, 'JHN.3', true), '<p>JHN.3 text</p>');
  let msg = ''; try { await off.chapter('K', 111, 'JHN.1', true); } catch (e) { msg = e.message; } eq('offline: unsaved msg', msg, 'No internet, and this chapter is not saved offline yet.');
  eq('offline: index from saved copy', (await off.index('K', 111, true)).fromCache, true);
  // download all (online), skips existing, ignores INTRO
  online = true; const prog = [];
  const r = await off.downloadAll('K', 111, (p) => prog.push(p.done + '/' + p.total), { pauseMs: 0 });
  eq('download all count', r.chapters, 4); eq('progress ends full', prog.at(-1), '4/4'); eq('failed none', r.failed, 0);
  // licence revoked -> copy deleted
  licensed = false; try { await off.index('K', 111, true); } catch { /* expected */ }
  eq('revoked: copy deleted', cache.stats(111).chapters, 0);
  // expiry: verifiedAt too old -> nothing returned, copy wiped
  licensed = true; await off.index('K', 222, true); await off.chapter('K', 222, 'JHN.1', true);
  const mf = path.join(dir, '222', 'meta.json'); fs.writeFileSync(mf, JSON.stringify({ verifiedAt: Date.now() - 61 * 86400000 }));
  online = false; let m2 = ''; try { await off.chapter('K', 222, 'JHN.1', true); } catch (e) { m2 = e.message; }
  eq('expired: not served', m2, 'No internet, and this chapter is not saved offline yet.'); eq('expired: wiped', fs.existsSync(path.join(dir, '222')), false);
  // Linux keyring missing ("basic_text" fallback) -> feature off
  if (process.platform === 'linux') {
    cache.setup(dir, { ...fakeSafe, getSelectedStorageBackend: () => 'basic_text' });
    eq('linux basic_text = off', cache.available(), false);
  }
  // no secure storage -> feature off
  cache.setup(dir, { isEncryptionAvailable: () => false }); online = true;
  let m3 = ''; try { await off.downloadAll('K', 333, () => {}, { pauseMs: 0 }); } catch (e) { m3 = e.message; } eq('no secure storage', /Secure storage/.test(m3), true);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
