// "Import a Bible" window: load a translation the church is licensed to use.
import { useState } from 'react';
import { parseBibleFile } from '../shared/bibleImport.js';
import { BUILTIN_IDS, forgetBible } from './bible.js';

const api = window.presenter;

export default function ImportBible({ imported, onClose, onImported, onRemoved }) {
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
        <h3>Import a Bible</h3>
        {!api?.biblesSave ? (
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
          {parsed && <button className="btn primary" disabled={busy || !!idProblem || !permission} onClick={save}>Import {cleanId || ''}</button>}
        </div>
      </div>
    </div>
  );
}
