// "Import a Bible" window: load a translation the church is licensed to use.
import { useEffect, useState } from 'react';
import { parseBibleFile } from '../shared/bibleImport.js';
import { BUILTIN_IDS, forgetBible } from './bible.js';
import { yvConfig, listYvVersions, attributionText } from './youversion.js';

const api = window.presenter;

function YouVersionSetup({ onSaved }) {
  const [key, setKey] = useState(yvConfig.key());
  const [editingKey, setEditingKey] = useState(!yvConfig.key());
  const [lang, setLang] = useState('en');
  const [list, setList] = useState(null);
  const [chosen, setChosen] = useState(() => new Set(yvConfig.versions().map((v) => v.yvId)));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const k = key.trim();
    if (!k) { setMsg('Paste your App Key first.'); return; }
    setBusy(true); setMsg('Asking YouVersion which versions your key can use…');
    try {
      const vs = await listYvVersions(k, lang.trim() || 'en');
      yvConfig.setKey(k); setEditingKey(false);
      setList(vs);
      setMsg(vs.length ? '' : 'No versions found for that language with this key.');
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const toggle = (id) => setChosen((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = () => {
    const keep = yvConfig.versions().filter((v) => chosen.has(v.yvId) && !(list || []).some((x) => x.yvId === v.yvId));
    const before = new Map(yvConfig.versions().map((v) => [v.yvId, v]));
    const add = (list || []).filter((v) => chosen.has(v.yvId)).map((v) => ({ id: `YV${v.yvId}`, yvId: v.yvId, abbreviation: v.abbreviation, title: v.title, attribution: attributionText(v), offline: !!before.get(v.yvId)?.offline }));
    const all = [...keep, ...add];
    // removed versions: delete their offline copies too
    for (const v of before.values()) if (!all.some((x) => x.yvId === v.yvId)) api.yvCacheClear?.(v.yvId);
    yvConfig.setVersions(all);
    onSaved(all);
  };

  if (!window.presenter?.yvVersions) return <p className="muted">Online Bibles work in the desktop app.</p>;
  return (
    <div className="yv">
      <p className="muted">Show Bibles your <b>YouVersion Platform</b> App Key is licensed for (from platform.youversion.com). They need internet; verses are fetched as you use them and shown with the publisher’s copyright line. The key stays on this PC.</p>
      <div className="ls-row">
        <label>App Key</label>
        {editingKey ? (
          <div className="key-row"><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your YouVersion App Key" onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
        ) : (
          <span className="muted">Saved on this PC ••••{key.slice(-4)} · <button className="link" onClick={() => setEditingKey(true)}>change</button> · <button className="link" onClick={() => { yvConfig.setKey(''); setKey(''); setEditingKey(true); setList(null); }}>remove</button></span>
        )}
      </div>
      <div className="yv-row">
        <label className="yv-lang">Language<input value={lang} onChange={(e) => setLang(e.target.value)} maxLength={10} /></label>
        <button className="btn primary" disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Show my versions'}</button>
      </div>
      {msg && <div className="notice slim">{msg}</div>}
      {list && list.length > 0 && (
        <div className="yv-list">
          {list.map((v) => (
            <label key={v.yvId} className={`yv-item ${chosen.has(v.yvId) ? 'sel' : ''}`}>
              <input type="checkbox" checked={chosen.has(v.yvId)} onChange={() => toggle(v.yvId)} />
              <b>{v.abbreviation}</b> <span>{v.title}</span>
            </label>
          ))}
        </div>
      )}
      {list && <div className="row end"><button className="btn primary" onClick={save}>Add {chosen.size} to Bible menu</button></div>}
      {!list && yvConfig.versions().length > 0 && <OfflineCopies onSaved={onSaved} />}
    </div>
  );
}

/** Per-version offline copy: opt-in (licence confirmation), Download all, delete. */
function OfflineCopies({ onSaved }) {
  const [versions, setVersions] = useState(yvConfig.versions());
  const [stats, setStats] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [progress, setProgress] = useState({});
  const [msg, setMsg] = useState('');

  const refresh = () => versions.forEach((v) => api.yvCacheStats?.(v.yvId).then((st) => setStats((s) => ({ ...s, [v.yvId]: st }))));
  useEffect(() => { refresh(); }, [versions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => api.onYvProgress?.((p) => setProgress((x) => ({ ...x, [p.yvId]: p }))), []);

  const setOffline = (yvId, on) => {
    const all = versions.map((v) => (v.yvId === yvId ? { ...v, offline: on } : v));
    yvConfig.setVersions(all);
    setVersions(all);
    if (!on) api.yvCacheClear?.(yvId).then(refresh);
    setConfirming(null);
    onSaved(all, { stayOpen: true });
  };
  const downloadAll = async (v) => {
    setMsg('');
    setProgress((x) => ({ ...x, [v.yvId]: { done: 0, total: 0 } }));
    const r = await api.yvDownloadAll(yvConfig.key(), v.yvId);
    setProgress((x) => ({ ...x, [v.yvId]: null }));
    if (!r.ok) setMsg(r.error);
    else if (r.data.failed) setMsg(`${v.abbreviation}: ${r.data.failed} chapters could not be fetched — press Download all again to retry.`);
    refresh();
  };
  const ago = (t) => { if (!t) return 'not checked yet'; const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? 'checked today' : `checked ${d} day${d > 1 ? 's' : ''} ago`; };

  return (
    <div className="yv-offline">
      <div className="group">In your Bible menu · offline copies</div>
      {versions.map((v) => {
        const st = stats[v.yvId];
        const pr = progress[v.yvId];
        return (
          <div key={v.yvId} className="yv-off-row">
            <div className="yv-off-top">
              <b>{v.abbreviation}</b> <span className="muted">{v.title}</span>
              <label className="switch" title="Keep an offline copy">
                <input type="checkbox" checked={!!v.offline} disabled={st && !st.available} onChange={(e) => (e.target.checked ? setConfirming(v.yvId) : setOffline(v.yvId, false))} />
                <span />
              </label>
            </div>
            {st && !st.available && <div className="muted small">Offline copies need Windows secure storage, which isn’t available on this PC.</div>}
            {confirming === v.yvId && (
              <div className="notice slim">
                Only switch this on if the licence for <b>{v.abbreviation}</b> allows storing it offline. The copy is encrypted for this Windows user, re-checked with YouVersion when online, and deleted if access ends or it isn’t re-checked for {st?.maxAgeDays || 60} days.
                <div className="row end">
                  <button className="btn small ghost" onClick={() => setConfirming(null)}>Cancel</button>
                  <button className="btn small primary" onClick={() => setOffline(v.yvId, true)}>Our licence allows it — turn on</button>
                </div>
              </div>
            )}
            {v.offline && st?.available && (
              <div className="yv-off-actions">
                <span className="muted small">Saved: {st.chapters.toLocaleString()} chapters · {ago(st.verifiedAt)}</span>
                {pr ? (
                  <>
                    <div className="meter dl grow"><div style={{ width: `${pr.total ? (100 * pr.done) / pr.total : 0}%` }} /></div>
                    <span className="small">{pr.total ? `${pr.done}/${pr.total}` : 'Starting…'}</span>
                    <button className="link" onClick={() => api.yvCancelDownload(v.yvId)}>stop</button>
                  </>
                ) : (
                  <>
                    <button className="btn small" onClick={() => downloadAll(v)}>Download all</button>
                    {st.chapters > 0 && <button className="link" onClick={() => api.yvCacheClear(v.yvId).then(refresh)}>delete copy</button>}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {msg && <div className="notice slim">{msg}</div>}
      <div className="muted small">Without an offline copy, online Bibles need internet. Chapters you open are saved automatically once the copy is on.</div>
    </div>
  );
}

export default function ImportBible({ imported, onClose, onImported, onRemoved, onYvSaved }) {
  const [tab, setTab] = useState('file');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [permission, setPermission] = useState(false);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setParsed(null);
    setError('');
    setBusy(true);
    try {
      const text = await f.text();
      await new Promise((r) => setTimeout(r, 0));
      const r = parseBibleFile(text, f.name);
      setParsed(r);
      const guess = f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
      if (!id) setId(guess);
      if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setError(err.message || 'Could not read this file.');
    } finally {
      setBusy(false);
    }
  };

  const cleanId = id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const idProblem = !cleanId ? 'Give it a short name, e.g. NIV' : BUILTIN_IDS.has(cleanId) ? `${cleanId} is already built in — use another short name` : '';
  const sample = (b, c, v) => parsed?.books[b]?.chapters[c - 1]?.[v - 1] || '— missing —';

  const save = async () => {
    if (!parsed || idProblem || !permission) return;
    setBusy(true);
    try {
      const data = { id: cleanId, name: name.trim() || cleanId, books: parsed.books.map((b) => ({ chapters: b.chapters })) };
      forgetBible(cleanId);
      await api.biblesSave(cleanId, data.name, JSON.stringify(data));
      onImported(cleanId);
    } catch (err) {
      setError(err.message || 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a Bible</h3>
        <div className="seg imp-tabs">
          <button className={tab === 'file' ? 'sel' : ''} onClick={() => setTab('file')}>From a file</button>
          <button className={tab === 'yv' ? 'sel' : ''} onClick={() => setTab('yv')}>YouVersion (online)</button>
        </div>
        {tab === 'yv' ? (
          <YouVersionSetup onSaved={onYvSaved} />
        ) : !api?.biblesSave ? (
          <p className="muted">Importing works in the desktop app.</p>
        ) : (
          <>
            <p className="muted">
              Load a translation your church is allowed to use (for example NIV or NKJV after getting permission from the publisher).
              It is stored on this PC only. Files: <b>Zefania XML</b>, <b>OSIS</b>, <b>USFX</b>, <b>JSON</b>, or <b>CSV/TSV</b> (Book, Chapter, Verse, Text).
            </p>
            <label className="btn file-btn">
              {busy && !parsed ? 'Reading…' : file ? 'Choose another file…' : 'Choose Bible file…'}
              <input type="file" accept=".xml,.json,.csv,.tsv,.txt,.osis,.usfx" hidden onChange={pick} />
            </label>
            {file && <span className="muted small file-name">{file.name}</span>}
            {error && <div className="notice slim">{error}</div>}

            {parsed && (
              <div className="imp-preview">
                <div className="imp-stats">
                  <span className="ok-pill">Read OK</span> {parsed.stats.format} · {parsed.stats.books} books · {parsed.stats.verses.toLocaleString()} verses
                  {parsed.stats.books < 66 && <span className="warn-txt"> · some books missing</span>}
                </div>
                {parsed.stats.skipped.length > 0 && <div className="muted small">Skipped (not in the 66 books): {parsed.stats.skipped.slice(0, 8).join(', ')}{parsed.stats.skipped.length > 8 ? '…' : ''}</div>}
                <div className="imp-sample"><b>John 3:16</b> {sample(42, 3, 16)}</div>
                <div className="imp-sample"><b>Psalm 23:1</b> {sample(18, 23, 1)}</div>
                <div className="imp-fields">
                  <label>Short name<input value={id} maxLength={10} onChange={(e) => setId(e.target.value)} placeholder="NIV" /></label>
                  <label className="grow">Full name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="New International Version" /></label>
                </div>
                {idProblem && <div className="muted small">{idProblem}</div>}
                <label className="ls-check perm">
                  <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
                  Our church has the right to use this translation (public domain, or licensed by the publisher).
                </label>
              </div>
            )}

            {imported.length > 0 && (
              <div className="imp-list">
                <div className="group">Imported on this PC</div>
                {imported.map((b) => (
                  <div key={b.id} className="imp-item">
                    <b>{b.id}</b> <span className="muted">{b.name}</span>
                    <button className="link" onClick={async () => { forgetBible(b.id); onRemoved(await api.biblesRemove(b.id), b.id); }}>remove</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {tab === 'file' && parsed && <button className="btn primary" disabled={busy || !!idProblem || !permission} onClick={save}>Import {cleanId || ''}</button>}
        </div>
      </div>
    </div>
  );
}
