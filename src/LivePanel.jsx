// Live tab: listens to the sermon, shows the transcript, and lists scriptures it hears.
import { useEffect, useRef, useState } from 'react';
import { ScriptureDetector } from '../shared/detector.js';
import { QuoteIndex } from '../shared/quotes.js';
import { listMics, startMic } from './audio.js';
import { verseText, loadBible, TRANSLATIONS } from './bible.js';

const api = window.presenter;

function usePersist(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(`cp.${key}`); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(`cp.${key}`, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}

const STATE_TEXT = {
  off: 'Not listening',
  starting: 'Starting microphone…',
  connecting: 'Connecting…',
  loading: 'Loading offline model…',
  listening: 'Listening',
  reconnecting: 'Internet dropped — reconnecting…',
  stopped: 'Not listening',
};

export default function LivePanel({ hidden, bible, live, present, addToQueue, onBadge, onListening, flash }) {
  const [apiKey, setApiKey] = usePersist('dgKey', '');
  const [engine, setEngine] = usePersist('sttEngine', 'cloud'); // 'cloud' | 'offline'
  const [offlineModel, setOfflineModel] = usePersist('offlineModel', 'parakeet');
  const [models, setModels] = useState([]);
  const [modelProgress, setModelProgress] = useState(null); // {id, phase, received, total}
  const [modelMsg, setModelMsg] = useState('');
  const [quotesReady, setQuotesReady] = useState(false);
  const [micId, setMicId] = usePersist('micId', '');
  const [noise, setNoise] = usePersist('noiseSuppression', true);
  const [autoPresent, setAutoPresent] = usePersist('autoPresent', false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyMsg, setKeyMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mics, setMics] = useState([]);
  const [state, setState] = useState('off');
  const [error, setError] = useState('');
  const [finals, setFinals] = useState([]);
  const [interim, setInterim] = useState('');
  const [detections, setDetections] = useState([]);
  const [level, setLevel] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [, tick] = useState(0);
  const [popup, setPopup] = useState(null);
  const micRef = useRef(null);
  const detectorRef = useRef(null);
  const transcriptRef = useRef(null);
  const unseenRef = useRef(0);
  const autoRef = useRef(autoPresent);
  autoRef.current = autoPresent;
  const presentRef = useRef(present);
  presentRef.current = present;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  const listening = state !== 'off' && state !== 'stopped';

  useEffect(() => {
    if (bible && !detectorRef.current) detectorRef.current = new ScriptureDetector(bible.books);
  }, [bible]);
  // Follow what the operator shows, so "verse 17" means the right chapter
  useEffect(() => { if (live) detectorRef.current?.setContext(live); }, [live]);
  useEffect(() => { onListening?.(listening); }, [listening]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!hidden) { unseenRef.current = 0; onBadge?.(0); setPopup(null); } }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listMics().then(setMics); }, []);

  // Offline models: what is installed, download progress
  const refreshModels = () => api?.modelsList?.().then((r) => { setModels(r.models); if (r.busy) setModelProgress((p) => p || { id: r.busy, phase: 'download' }); });
  useEffect(() => {
    refreshModels();
    if (!api?.onModelsProgress) return;
    return api.onModelsProgress((p) => setModelProgress(p.phase === 'done' ? null : p));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const modelInfo = models.find((m) => m.id === offlineModel);
  const offlineReady = !!modelInfo?.installed;

  async function getModel(id, fromFile = false) {
    setModelMsg('');
    setModelProgress({ id, phase: fromFile ? 'unpack' : 'download', received: 0, total: 0 });
    const r = fromFile ? await api.modelsInstallFile(id) : await api.modelsDownload(id);
    setModelProgress(null);
    if (!r.ok && !r.canceled) {
      const url = await api.modelsUrl?.(id);
      setModelMsg(fromFile ? r.message : `${r.message}${url ? `\nBrowser link: ${url}` : ''}`);
    }
    if (r.ok) flash?.('Offline model installed');
    refreshModels();
  }

  // Quote matching: index all Bibles in the background (takes a few seconds, once)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const bibles = await Promise.all(TRANSLATIONS.map((t) => loadBible(t.id)));
        const idx = await QuoteIndex.create(bibles);
        if (!alive) return;
        const attach = () => { if (detectorRef.current) detectorRef.current.setQuoteIndex(idx); else setTimeout(attach, 500); };
        attach();
        setQuotesReady(true);
      } catch { /* quote matching stays off */ }
    }, 1500);
    return () => { alive = false; clearTimeout(t); };
  }, []);
  useEffect(() => {
    if (!popup) return;
    const t = setTimeout(() => setPopup(null), 12000);
    return () => clearTimeout(t);
  }, [popup]);
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [startedAt]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [finals, interim]);

  // Messages from the transcription service
  useEffect(() => {
    if (!api?.onStt) return;
    return api.onStt((ev) => {
      if (ev.type === 'status') {
        setState(ev.state);
        if (ev.state === 'listening') setError('');
      } else if (ev.type === 'error') {
        setError(ev.message);
        if (ev.fatal) stopListening(true);
      } else if (ev.type === 'result') {
        if (!ev.isFinal) { setInterim(ev.text); return; }
        setInterim('');
        if (!ev.text.trim()) return;
        const now = Date.now();
        setFinals((f) => [...f.slice(-300), { id: now + Math.random(), text: ev.text, at: now }]);
        const found = detectorRef.current?.feed(ev.text, now) || [];
        if (found.length) {
          setDetections((d) => [...found.slice().reverse(), ...d].slice(0, 60));
          const best = found[found.length - 1];
          if (autoRef.current && best.confidence >= 90) {
            presentRef.current(best.ref);
          } else if (hiddenRef.current) {
            setPopup(best);
          }
          if (hiddenRef.current) {
            unseenRef.current += found.length;
            onBadge?.(unseenRef.current);
          }
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function startListening() {
    if (!api?.sttStart) { setError('Live transcription works in the desktop app.'); return; }
    if (engine === 'cloud' && !apiKey) { setShowSettings(true); setError('Add your Deepgram key, or switch to Offline (free).'); return; }
    if (engine === 'offline' && !offlineReady) { setShowSettings(true); setError('Download the offline model first (Live → ⚙).'); return; }
    setError('');
    setState('starting');
    try {
      await api.sttStart(engine === 'offline' ? { engine: 'offline', model: offlineModel } : { engine: 'cloud', apiKey, language: 'en' });
      micRef.current = await startMic({
        deviceId: micId || undefined,
        noiseSuppression: noise,
        onChunk: (buf) => api.sttAudio(buf),
        onLevel: (rms) => setLevel(Math.min(1, rms * 6)),
      });
      setStartedAt(Date.now());
      listMics().then(setMics); // names appear after permission is granted
    } catch (e) {
      api.sttStop();
      setState('off');
      setError(e?.name === 'NotAllowedError' ? 'Windows blocked the microphone. Allow it in Settings → Privacy → Microphone.' : `Microphone problem: ${e.message}`);
    }
  }

  function stopListening(keepError = false) {
    micRef.current?.stop();
    micRef.current = null;
    api?.sttStop?.();
    setState('off');
    setLevel(0);
    setInterim('');
    setStartedAt(null);
    if (!keepError) setError('');
  }

  async function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    setTesting(true);
    setKeyMsg('Checking key…');
    const r = api?.sttTest ? await api.sttTest(k) : { ok: false, message: 'Desktop app only' };
    setTesting(false);
    if (r.ok) {
      setApiKey(k);
      setKeyDraft('');
      setKeyMsg('');
      setError('');
      flash?.('Deepgram key saved');
    } else setKeyMsg(r.message);
  }

  const minutes = startedAt ? Math.floor((Date.now() - startedAt) / 60000) : 0;
  const detCard = (d, compact = false) => (
    <div key={d.id} className={`det ${compact ? 'compact' : ''}`}>
      <div className="det-top">
        <span className={`conf c${d.confidence >= 90 ? 'hi' : d.confidence >= 70 ? 'mid' : 'lo'}`}>{d.confidence}%</span>
        <span className="det-ref">{d.label}</span>
        {d.kind === 'quote' && <span className="det-kind" title="The preacher quoted this verse without naming it">quoted</span>}
        <span className="det-time">{new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      {!compact && bible && <div className="det-text">{verseText(bible, d.ref)}</div>}
      <div className="det-heard">heard: “{d.heard}”</div>
      <div className="det-actions">
        <button className="btn small" onClick={() => { const refs = []; const end = d.endVerse || d.ref.verse; for (let v = d.ref.verse; v <= end; v++) refs.push({ ...d.ref, verse: v }); addToQueue(refs); flash?.('Added to queue'); }}>＋ Queue</button>
        <button className="btn small primary" onClick={() => { present(d.ref); setPopup(null); }}>▶ Present</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="live" style={{ display: hidden ? 'none' : 'flex' }}>
        <div className="live-head">
          {listening ? (
            <button className="btn big stop" onClick={() => stopListening()}>■ Stop</button>
          ) : (
            <button className="btn big start" onClick={startListening}>🎙 Start listening</button>
          )}
          <div className="live-status">
            <div className={`st ${state}`}>
              {STATE_TEXT[state] || state}{listening && minutes > 0 ? ` · ${minutes} min` : ''}
            </div>
            <div className="meter"><div style={{ width: `${Math.round(level * 100)}%` }} /></div>
            <div className="engine-line">{engine === 'offline' ? `Offline · free · ${modelInfo?.name.split('—')[1]?.trim() || ''}` : 'Cloud · Deepgram'}</div>
          </div>
          <button className="mini" title="Settings" onClick={() => setShowSettings((v) => !v)}>⚙</button>
        </div>

        {error && <div className="notice slim">{error}</div>}

        {(showSettings || (engine === 'cloud' ? !apiKey : !offlineReady)) && (
          <div className="live-settings">
            <div className="ls-row">
              <label>Speech engine</label>
              <div className="seg engine-seg">
                <button className={engine === 'cloud' ? 'sel' : ''} disabled={listening} onClick={() => setEngine('cloud')}>Cloud · Deepgram</button>
                <button className={engine === 'offline' ? 'sel' : ''} disabled={listening} onClick={() => setEngine('offline')}>Offline · free</button>
              </div>
              <span className="muted small">{engine === 'cloud' ? 'Most accurate. Needs internet; paid per minute after the free credit.' : 'Runs on this PC. No internet, no cost. Text appears after each phrase.'}</span>
            </div>
            {engine === 'offline' && (
              <div className="ls-row">
                <label>Offline model</label>
                {models.map((m) => (
                  <div key={m.id} className={`model-row ${offlineModel === m.id ? 'sel' : ''}`}>
                    <label className="ls-check">
                      <input type="radio" name="model" checked={offlineModel === m.id} onChange={() => setOfflineModel(m.id)} disabled={listening} />
                      <span><b>{m.name}</b><br /><span className="muted small">{m.note}</span></span>
                    </label>
                    <div className="model-act">
                      {m.installed ? (
                        <span className="ok-pill">Installed</span>
                      ) : modelProgress?.id === m.id ? (
                        <span className="muted small">
                          {modelProgress.phase === 'unpack' ? 'Unpacking…' : modelProgress.phase === 'vad' ? 'Preparing…' : modelProgress.total ? `${Math.round((100 * modelProgress.received) / modelProgress.total)}%` : 'Starting…'}
                        </span>
                      ) : (
                        <>
                          <button className="btn small primary" disabled={!!modelProgress} onClick={() => getModel(m.id)}>Download</button>
                          <button className="link" disabled={!!modelProgress} onClick={() => getModel(m.id, true)}>from file…</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {modelProgress?.phase === 'download' && modelProgress.total > 0 && (
                  <div className="meter dl"><div style={{ width: `${(100 * modelProgress.received) / modelProgress.total}%` }} /></div>
                )}
                {modelMsg && <div className="notice slim">{modelMsg}</div>}
              </div>
            )}
            {engine === 'cloud' && <div className="ls-row">
              <label>Deepgram key</label>
              {apiKey && !keyDraft ? (
                <span className="muted">Saved on this PC ••••{apiKey.slice(-4)} · <button className="link" onClick={() => setKeyDraft(' ')}>change</button> · <button className="link" disabled={listening} onClick={() => { setApiKey(''); flash?.('Deepgram key removed from this PC'); }}>remove</button></span>
              ) : (
                <div className="key-row">
                  <input type="password" placeholder="Paste your key from console.deepgram.com" value={keyDraft.trimStart()} onChange={(e) => setKeyDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} />
                  <button className="btn small primary" disabled={testing} onClick={saveKey}>Save</button>
                </div>
              )}
            </div>}
            {engine === 'cloud' && keyMsg && <div className="muted small">{keyMsg}</div>}
            <div className="ls-row">
              <label>Microphone</label>
              <select className="dropdown" value={micId} onChange={(e) => setMicId(e.target.value)} disabled={listening}>
                <option value="">Windows default</option>
                {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <label className="ls-check"><input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} disabled={listening} /> Reduce background noise</label>
            <label className="ls-check"><input type="checkbox" checked={autoPresent} onChange={(e) => setAutoPresent(e.target.checked)} /> Put named verses on screen automatically (95% only)</label>
            <div className="muted small">Quoted-verse matching: {quotesReady ? 'ready' : 'getting ready…'}</div>
          </div>
        )}

        <div className="live-section-title">Detected scriptures {detections.length > 0 && <button className="link" onClick={() => setDetections([])}>Clear</button>}</div>
        <div className="dets">
          {detections.length === 0 && <div className="empty small">When the preacher names or quotes a scripture, it shows up here.</div>}
          {detections.map((d) => detCard(d))}
        </div>

        <div className="live-section-title">Live transcript {finals.length > 0 && <button className="link" onClick={() => setFinals([])}>Clear</button>}</div>
        <div className="transcript" ref={transcriptRef}>
          {finals.length === 0 && !interim && <div className="empty small">{listening ? 'Waiting for speech…' : 'Press Start listening when the sermon begins.'}</div>}
          {finals.map((f) => <span key={f.id}>{f.text} </span>)}
          {interim && <span className="interim">{interim}</span>}
        </div>
      </div>

      {hidden && popup && (
        <div className="det-popup">
          <button className="popup-x" onClick={() => setPopup(null)}>✕</button>
          <div className="muted small">Scripture detected</div>
          {detCard(popup, true)}
        </div>
      )}
    </>
  );
}
