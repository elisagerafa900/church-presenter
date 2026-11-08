import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { BOOKS, parseQuery, suggestBooks } from '../shared/bibleRef.js';
import { TRANSLATIONS, loadBible, verseText, refLabel, sameRef, searchText, importedBibles } from './bible.js';
import ImportBible from './ImportBible.jsx';
import { BUILTIN_THEMES, imageFileToDataUrl } from './themes.js';
import { Slide, Stage } from './Slide.jsx';
import LivePanel from './LivePanel.jsx';

const api = window.presenter; // undefined when opened in a normal browser

function usePersist(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(`cp.${key}`);
      return s ? JSON.parse(s) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(`cp.${key}`, JSON.stringify(v)); } catch { /* storage full or blocked */ }
  }, [key, v]);
  return [v, setV];
}

function step(bible, ref, dir) {
  if (!bible || !ref) return null;
  const chs = bible.books[ref.book].chapters;
  let { book, chapter, verse } = ref;
  verse += dir;
  if (verse < 1) {
    if (chapter > 1) { chapter -= 1; verse = chs[chapter - 1].length; } else return null;
  } else if (verse > chs[chapter - 1].length) {
    if (chapter < chs.length) { chapter += 1; verse = 1; } else return null;
  }
  return { book, chapter, verse };
}

export default function App() {
  const [tid, setTid] = usePersist('translation', 'KJV');
  const [imported, setImported] = useState([]);
  const [showImport, setShowImport] = useState(false);
  useEffect(() => { importedBibles().then(setImported); }, []);
  const allTranslations = [...TRANSLATIONS, ...imported];
  const [bible, setBible] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [nav, setNav] = usePersist('nav', { book: 42, chapter: 3 });
  const [preview, setPreview] = useState({ book: 42, chapter: 3, verse: 16 });
  const [live, setLive] = useState(null);
  const [mode, setMode] = useState('clear');
  const [queue, setQueue] = usePersist('queue', []);
  const [themeId, setThemeId] = usePersist('theme', 'midnight');
  const [customThemes, setCustomThemes] = usePersist('customThemes', []);
  const [query, setQuery] = useState('');
  const [sugIdx, setSugIdx] = useState(0);
  const lastAuto = useRef(null); // {before, after} so Backspace can undo an autocomplete
  const [displays, setDisplays] = useState([]);
  const [displayId, setDisplayId] = usePersist('displayId', null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [monitorLayout, setMonitorLayout] = useState('full');
  const [leftTab, setLeftTab] = useState('bible');
  const [liveBadge, setLiveBadge] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [update, setUpdate] = useState(null);
  useEffect(() => {
    if (!api?.onUpdate) return;
    api.updateStatus().then(setUpdate);
    return api.onUpdate(setUpdate);
  }, []);
  const [showOutputs, setShowOutputs] = useState(false);
  const [webInfo, setWebInfo] = useState(null);
  const [ndiCfg, setNdiCfg] = usePersist('ndi', {
    fps: 30,
    full: { enabled: false, name: 'Church Presenter Main' },
    lower: { enabled: false, name: 'Church Presenter Lower Third' },
  });
  const [ndiStatus, setNdiStatus] = useState(null);
  const [ndiNames, setNdiNames] = useState({ full: ndiCfg.full.name, lower: ndiCfg.lower.name });
  const [showBrowserSrc, setShowBrowserSrc] = useState(false);
  const [toast, setToast] = useState('');
  const searchRef = useRef(null);
  const fileRef = useRef(null);
  const verseListRef = useRef(null);

  const themes = useMemo(() => [...BUILTIN_THEMES, ...customThemes], [customThemes]);
  const theme = themes.find((t) => t.id === themeId) || BUILTIN_THEMES[0];

  // Load translation
  useEffect(() => {
    let alive = true;
    setLoadError('');
    loadBible(tid).then((b) => alive && setBible(b)).catch((e) => alive && setLoadError(e.message));
    return () => { alive = false; };
  }, [tid]);

  // Displays + output status (Electron only)
  const refreshDisplays = useCallback(() => {
    api?.listDisplays().then((d) => {
      setDisplays(d);
      setDisplayId((cur) => (d.some((x) => x.id === cur) ? cur : (d.find((x) => !x.primary) || d[0])?.id ?? null));
    });
  }, [setDisplayId]);
  useEffect(() => {
    if (!api) return;
    refreshDisplays();
    const off1 = api.onOutputStatus((s) => setOutputOpen(s.open));
    const off2 = api.onDisplaysChanged(refreshDisplays);
    const off3 = api.onNdiStatus ? api.onNdiStatus(setNdiStatus) : () => {};
    return () => { off1(); off2(); off3(); };
  }, [refreshDisplays]);

  // Start / stop NDI sources whenever the settings change (and on startup)
  useEffect(() => {
    api?.setNdi?.(ndiCfg).then(setNdiStatus).catch(() => {});
  }, [ndiCfg]);
  const ndiOn = !!ndiStatus && ['full', 'lower'].some((l) => ndiStatus.sources?.[l]?.running);
  const ndiWatchers = ndiStatus ? ['full', 'lower'].reduce((n, l) => n + (ndiStatus.sources?.[l]?.connections || 0), 0) : 0;
  const setNdiSource = (layout, patch) => setNdiCfg((c) => ({ ...c, [layout]: { ...c[layout], ...patch } }));
  const commitNdiName = (layout) => {
    const name = ndiNames[layout].trim();
    if (name && name !== ndiCfg[layout].name) setNdiSource(layout, { name });
    else setNdiNames((n) => ({ ...n, [layout]: ndiCfg[layout].name }));
  };

  // What goes to the screens
  const outState = useMemo(
    () => ({
      mode,
      slide: live && bible ? { text: verseText(bible, live), ref: refLabel(live), translation: tid } : null,
      theme,
    }),
    [mode, live, bible, tid, theme],
  );
  useEffect(() => { api?.sendState(outState); }, [outState]);

  const flash = (msg) => { setToast(msg); clearTimeout(flash.t); flash.t = setTimeout(() => setToast(''), 2200); };

  // ---------- actions ----------
  const goTo = (ref) => {
    setNav({ book: ref.book, chapter: ref.chapter });
    setPreview({ book: ref.book, chapter: ref.chapter, verse: ref.verse || 1 });
  };
  const present = (ref) => {
    if (!ref) return;
    setLive(ref);
    setMode('live');
    goTo(ref);
  };
  const addToQueue = (refs) => {
    setQueue((q) => [...q, ...refs.filter((r) => !q.some((x) => sameRef(x, r)))]);
  };
  const toggleBlack = () => setMode((m) => (m === 'black' ? (live ? 'live' : 'clear') : 'black'));
  const toggleClear = () => setMode((m) => (m === 'clear' ? (live ? 'live' : 'clear') : 'clear'));
  const stepLive = (dir) => {
    const n = step(bible, live || preview, dir);
    if (n) present(n);
  };
  const toggleOutput = () => {
    if (!api) return flash('Open the desktop app to use the projector.');
    if (outputOpen) api.closeOutput();
    else api.openOutput(displayId);
  };

  // ---------- search ----------
  // EasyWorship-style stages: "Matthew " -> pick chapter, "Matthew 11:" -> pick verse.
  const stage = useMemo(() => {
    if (!bible) return null;
    const m = query.match(/^\s*([123]?\s*[a-z][a-z .]*?)\s+(\d+)?\s*(:|\s)?\s*(\d+)?\s*$/i);
    if (!m) return null;
    const bookPart = m[1].trim().toLowerCase();
    const book = suggestBooks(bookPart)[0];
    if (book === undefined) return null;
    // Without numbers, only when the full book name is typed ("matthew ", not "ma ")
    if (!m[2] && BOOKS[book].toLowerCase() !== bookPart) return null;
    const chapters = bible.books[book].chapters;
    if (!m[2]) return { kind: 'chapter', book, filter: '' };
    const chapter = +m[2];
    if (!m[3]) return { kind: 'chapter', book, filter: m[2], chapter: chapter <= chapters.length ? chapter : null };
    if (chapter < 1 || chapter > chapters.length) return null;
    const verse = m[4] ? +m[4] : null;
    return { kind: 'verse', book, chapter, filter: m[4] || '', verse: verse && verse <= chapters[chapter - 1].length ? verse : null };
  }, [query, bible]);
  const sugs = useMemo(() => (stage ? [] : suggestBooks(query)), [query, stage]);
  const sugBook = sugs.length ? sugs[Math.min(sugIdx, sugs.length - 1)] : undefined;
  const ghost = useMemo(() => {
    if (sugBook === undefined || !query) return null;
    const full = BOOKS[sugBook];
    if (full.toLowerCase().startsWith(query.toLowerCase())) return { rest: full.slice(query.length) };
    if (/\s$/.test(query)) return null;
    return { chip: full }; // abbreviation like "jn" -> John
  }, [sugBook, query]);
  const changeQuery = (v) => { setQuery(v); setSugIdx(0); lastAuto.current = null; };
  const acceptSuggestion = (i = sugBook) => {
    if (i === undefined) return;
    const after = `${BOOKS[i]} `;
    lastAuto.current = { before: query, after };
    setQuery(after);
    setSugIdx(0);
    searchRef.current?.focus();
  };
  const onSearchKey = (e) => {
    const input = e.target;
    const atEnd = input.selectionStart === input.value.length;
    if (e.key === 'Backspace' && lastAuto.current && query === lastAuto.current.after) {
      e.preventDefault();
      const back = `${lastAuto.current.before} `;
      lastAuto.current = null;
      setQuery(back);
      return;
    }
    if (sugBook !== undefined && ghost) {
      // Space completes, unless the name itself continues with a space ("song" -> "song of solomon")
      const spaceOk = e.key === ' ' && atEnd && query.replace(/[^a-z]/gi, '').length >= 2 &&
        !BOOKS[sugBook].toLowerCase().startsWith(`${query.toLowerCase()} `);
      if (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd) || spaceOk) {
        e.preventDefault();
        acceptSuggestion();
        return;
      }
    }
    // "Matthew 11" + Space -> "Matthew 11:" and show its verses
    if ((e.key === ' ' || e.key === ':') && atEnd && stage?.kind === 'chapter' && stage.chapter) {
      e.preventDefault();
      setQuery(`${BOOKS[stage.book]} ${stage.chapter}:`);
      return;
    }
    if (sugs.length > 1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setSugIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : sugs.length - 1)) % sugs.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (sugBook !== undefined) {
        goTo({ book: sugBook, chapter: 1, verse: 1 });
        changeQuery('');
        input.blur();
      } else if (stage?.kind === 'verse' && stage.verse && parsed && !parsed.endVerse) {
        present({ book: stage.book, chapter: stage.chapter, verse: stage.verse });
        changeQuery('');
        input.blur();
      } else submitSearch();
    }
    if (e.key === 'Escape') { changeQuery(''); input.blur(); }
  };
  const parsed = useMemo(() => (bible && query.trim() ? parseQuery(query, bible.books) : null), [query, bible]);
  useEffect(() => {
    if (!stage) return;
    if (stage.kind === 'chapter' && stage.chapter) setNav({ book: stage.book, chapter: stage.chapter });
    else if (stage.kind === 'chapter') setNav((n) => (n.book === stage.book ? n : { book: stage.book, chapter: 1 }));
    else if (stage.kind === 'verse') {
      setNav({ book: stage.book, chapter: stage.chapter });
      if (stage.verse) setPreview({ book: stage.book, chapter: stage.chapter, verse: stage.verse });
    }
  }, [stage?.kind, stage?.book, stage?.chapter, stage?.verse]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickNumber = (n) => {
    if (!stage) return;
    if (stage.kind === 'chapter') setQuery(`${BOOKS[stage.book]} ${n}:`);
    else setQuery(`${BOOKS[stage.book]} ${stage.chapter}:${n}`);
    searchRef.current?.focus();
  };
  const dq = useDeferredValue(query);
  const results = useMemo(() => {
    if (!bible || parsed || dq.trim().length < 3) return [];
    return searchText(bible, dq, 80);
  }, [bible, dq, parsed]);

  const submitSearch = () => {
    if (!parsed) {
      if (results[0]) goTo(results[0].ref);
      return;
    }
    if (parsed.verse && parsed.endVerse) {
      const refs = [];
      for (let v = parsed.verse; v <= parsed.endVerse; v++) refs.push({ book: parsed.book, chapter: parsed.chapter, verse: v });
      addToQueue(refs);
      flash(`Added ${refs.length} verses to the queue`);
    }
    goTo(parsed);
    changeQuery('');
    searchRef.current?.blur();
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      const typing =
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName) ||
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if ((e.key === '/' && !typing) || (e.ctrlKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setLeftTab('bible');
        setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); }, 0);
        return;
      }
      if (typing) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const n = step(bible, preview, k === 'ArrowDown' ? 1 : -1);
        if (n) goTo(n);
      } else if (k === 'Enter') { e.preventDefault(); present(preview); }
      else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); stepLive(1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); stepLive(-1); }
      else if (k.toLowerCase() === 'b') toggleBlack();
      else if (k.toLowerCase() === 'c') toggleClear();
      else if (k === 'Escape') setShowOutputs(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep preview verse visible in the list
  useEffect(() => {
    verseListRef.current?.querySelector('.verse.sel')?.scrollIntoView({ block: 'nearest' });
  }, [preview, nav]);

  const pickImage = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const image = await imageFileToDataUrl(f);
      const t = { id: `custom-${Date.now()}`, name: f.name.replace(/\.[^.]+$/, '').slice(0, 24), background: '#000', image, dim: 0.45, textColor: '#ffffff', refColor: '#ffd27a', font: 'sans', custom: true };
      setCustomThemes((c) => [...c, t]);
      setThemeId(t.id);
      flash('Background added');
    } catch {
      flash('Could not read that image');
    }
  };

  const openOutputsDialog = () => {
    setShowOutputs(true);
    api?.webInfo().then(setWebInfo);
    api?.ndiStatus?.().then(setNdiStatus);
  };

  const chapterVerses = bible?.books[nav.book]?.chapters[nav.chapter - 1] || [];
  const chapterCount = bible?.books[nav.book]?.chapters.length || 0;
  const previewState = { mode: 'live', slide: bible ? { text: verseText(bible, preview), ref: refLabel(preview), translation: tid } : null };

  const programStatus = mode === 'black' ? 'BLACK' : mode === 'clear' ? 'CLEARED' : live ? refLabel(live) : '—';

  return (
    <div className="app console">
      {/* ---------- top bar ---------- */}
      <header className="topbar">
        <div className="brand" title="Church Presenter"><span className="brand-mark">◆</span><span className="brand-name">Church Presenter</span></div>
        <div className="tb-group">
          <span className="tb-label">Bible</span>
          <select className="dropdown narrow" value={tid} onChange={(e) => (e.target.value === '__import' ? setShowImport(true) : setTid(e.target.value))} title={allTranslations.find((t) => t.id === tid)?.name}>
            {TRANSLATIONS.map((t) => <option key={t.id} value={t.id} title={t.name}>{t.id}</option>)}
            {imported.length > 0 && <option disabled>──────</option>}
            {imported.map((t) => <option key={t.id} value={t.id} title={t.name}>{t.id}</option>)}
            <option value="__import">+ Import…</option>
          </select>
        </div>
        <div className="tb-group">
          <span className="tb-label">Look</span>
          <select className="dropdown theme" value={theme.id} onChange={(e) => (e.target.value === '__add' ? fileRef.current.click() : setThemeId(e.target.value))} title="Background theme">
            {themes.map((t) => <option key={t.id} value={t.id}>{t.custom ? '🖼 ' : ''}{t.name}</option>)}
            <option value="__add">+ Use my own image…</option>
          </select>
          {theme.custom && (
            <button className="btn ghost small" title="Remove this image theme" onClick={() => { setCustomThemes((c) => c.filter((t) => t.id !== theme.id)); setThemeId('midnight'); }}>✕</button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        <div className="spacer" />
        {isListening && <span className="tb-rec"><span className="rec-dot" /> Listening</span>}
        {api && (
          <select className="dropdown screen" value={displayId ?? ''} onChange={(e) => { const id = +e.target.value; setDisplayId(id); if (outputOpen) api.openOutput(id); }} title="Projector screen">
            {displays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        )}
        <button className={`btn big golive ${outputOpen ? 'live-on' : ''}`} onClick={toggleOutput} title="Show / hide the projector window">
          <span className="dot" /> {outputOpen ? 'PROJECTOR ON' : 'PROJECTOR OFF'}
        </button>
        <button className="btn ghost" onClick={openOutputsDialog} title="Projector, livestream and NDI outputs">
          Outputs{ndiOn && <span className={`ndi-pill ${ndiWatchers ? 'watched' : ''}`} title={ndiWatchers ? `${ndiWatchers} NDI receiver(s) connected` : 'NDI on, nobody connected yet'}>NDI</span>}
        </button>
      </header>

      {/* ---------- monitors: preview + program ---------- */}
      <section className="monitors">
        <div className="mon-panel preview-panel">
          <div className="mon-head">
            <span className="mon-label">Preview</span>
            <span className="mon-ref">{refLabel(preview)}</span>
          </div>
          <div className="mon-body">
            <div className="monitor"><Stage><Slide state={previewState} theme={theme} /></Stage></div>
            <div className="mon-ctrl">
              <button className="take" onClick={() => present(preview)} title="Put the preview on air (Enter)">
                TAKE<small>Enter</small>
              </button>
              <button className="btn" onClick={() => { addToQueue([preview]); flash('Added to queue'); }}>＋ Queue</button>
            </div>
          </div>
        </div>

        <div className={`mon-panel program-panel ${outputOpen ? 'tally' : ''}`}>
          <div className="mon-head">
            <span className="mon-label">{outputOpen ? '● On air' : 'Program'}</span>
            <span className="mon-ref">{programStatus}</span>
            <div className="seg">
              <button className={monitorLayout === 'full' ? 'sel' : ''} onClick={() => setMonitorLayout('full')}>Projector</button>
              <button className={monitorLayout === 'lower' ? 'sel' : ''} onClick={() => setMonitorLayout('lower')}>Stream</button>
            </div>
          </div>
          <div className="mon-body">
            <div className={`monitor ${monitorLayout === 'lower' ? 'checker' : ''}`}>
              <Stage transparent={monitorLayout === 'lower'}><Slide state={outState} theme={theme} layout={monitorLayout} /></Stage>
            </div>
            <div className="mon-ctrl">
              <div className="ctrl-pair">
                <button className="btn" onClick={() => stepLive(-1)} title="Previous verse (←)">◀</button>
                <button className="btn" onClick={() => stepLive(1)} title="Next verse (→ or Space)">▶</button>
              </div>
              <button className={`btn ctrl ${mode === 'black' ? 'on' : ''}`} onClick={toggleBlack} title="Black screen (B)">BLACK</button>
              <button className={`btn ctrl ${mode === 'clear' ? 'on' : ''}`} onClick={toggleClear} title="Clear text, keep background (C)">CLEAR</button>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- workspace: library, chapter, live sermon ---------- */}
      <main className="workspace">
        <section className="panel left">
          <div className="tabs">
            <button className={leftTab !== 'queue' ? 'sel' : ''} onClick={() => setLeftTab('bible')}>Library</button>
            <button className={leftTab === 'queue' ? 'sel' : ''} onClick={() => setLeftTab('queue')}>
              Queue{queue.length > 0 && <span className="badge">{queue.length}</span>}
            </button>
          </div>
          {leftTab === 'queue' ? (
            <>
              <div className="queue-head">
                <span className="muted">{queue.length ? `${queue.length} verse${queue.length > 1 ? 's' : ''} waiting` : 'Empty'}</span>
                {queue.length > 0 && <button className="link" onClick={() => setQueue([])}>Clear all</button>}
              </div>
              <div className="qlist">
                {queue.length === 0 && <div className="empty">Verses you add with ＋ wait here, ready to show.</div>}
                {queue.map((r) => (
                  <div key={`${r.book}.${r.chapter}.${r.verse}`} className={`qitem ${sameRef(r, live) ? 'is-live' : ''}`} onClick={() => goTo(r)} onDoubleClick={() => present(r)}>
                    <div className="q-main">
                      <div className="q-ref">{refLabel(r)}</div>
                      <div className="q-text">{bible ? verseText(bible, r) : ''}</div>
                    </div>
                    <button className="mini go" title="Present" onClick={(e) => { e.stopPropagation(); present(r); }}>▶</button>
                    <button className="mini" title="Remove" onClick={(e) => { e.stopPropagation(); setQueue((q) => q.filter((x) => !sameRef(x, r))); }}>✕</button>
                  </div>
                ))}
              </div>
            </>
          ) : (
          <>
          <div className="search">
            <div className="search-field">
              {ghost?.rest && (
                <div className="ac-ghost" aria-hidden="true"><span className="ac-ghost-typed">{query}</span>{ghost.rest}</div>
              )}
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="John 3:16, ps 23, or words…"
                spellCheck={false}
                autoComplete="off"
              />
              {ghost?.chip && <span className="ac-ghost-chip">{ghost.chip}</span>}
            </div>
            {stage ? (
              <div className="hint">
                {stage.kind === 'chapter'
                  ? <>Type a chapter, then <kbd>Space</kbd></>
                  : <>Type a verse, then <kbd>Enter</kbd> to show it</>}
              </div>
            ) : sugBook !== undefined ? (
              <div className="hint"><kbd>Space</kbd> or <kbd>Tab</kbd> to complete{sugs.length > 1 ? <> · <kbd>↑</kbd><kbd>↓</kbd> other books</> : null}</div>
            ) : parsed && <div className="hint">↵ Go to <b>{BOOKS[parsed.book]} {parsed.chapter}{parsed.verse ? `:${parsed.verse}` : ''}{parsed.endVerse ? `-${parsed.endVerse}` : ''}</b>{parsed.endVerse ? ' (adds range to queue)' : ''}{bible && !parsed.verse ? <span className="muted"> · {bible.books[parsed.book].chapters[parsed.chapter - 1].length} verses</span> : null}</div>}
          </div>
          {stage ? (
            <div className="list">
              <div className="group">
                {stage.kind === 'chapter' ? `${BOOKS[stage.book]} · chapters` : `${BOOKS[stage.book]} ${stage.chapter} · verses`}
              </div>
              <div className="numgrid">
                {Array.from(
                  { length: stage.kind === 'chapter' ? bible.books[stage.book].chapters.length : bible.books[stage.book].chapters[stage.chapter - 1].length },
                  (_, i) => i + 1,
                ).map((n) => {
                  const match = stage.filter && String(n).startsWith(stage.filter);
                  const exact = stage.filter && String(n) === stage.filter;
                  return (
                    <button
                      key={n}
                      className={`num ${exact ? 'sel' : match ? 'match' : stage.filter ? 'dim' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickNumber(n)}
                      onDoubleClick={() => stage.kind === 'verse' && present({ book: stage.book, chapter: stage.chapter, verse: n })}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : sugs.length > 0 ? (
            <div className="list">
              {sugs.map((b, i) => (
                <button key={b} className={`book ${i === Math.min(sugIdx, sugs.length - 1) ? 'sel' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => acceptSuggestion(b)}>{BOOKS[b]}</button>
              ))}
            </div>
          ) : query.trim() && !parsed ? (
            <div className="list">
              {dq.trim().length < 3 && <div className="empty">Keep typing…</div>}
              {dq.trim().length >= 3 && results.length === 0 && <div className="empty">No verses found</div>}
              {results.map((r) => (
                <button key={`${r.ref.book}.${r.ref.chapter}.${r.ref.verse}`} className="result" onClick={() => goTo(r.ref)} onDoubleClick={() => present(r.ref)}>
                  <span className="r-ref">{refLabel(r.ref)}</span>
                  <span className="r-text">{r.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="list books">
              {BOOKS.map((b, i) => (
                <div key={b}>
                  {i === 0 && <div className="group">Old Testament</div>}
                  {i === 39 && <div className="group">New Testament</div>}
                  <button className={`book ${nav.book === i ? 'sel' : ''}`} onClick={() => setNav({ book: i, chapter: 1 })}>{b}</button>
                </div>
              ))}
            </div>
          )}
          </>
          )}
        </section>

        <section className="panel middle">
          <div className="chapter-head">
            <h2>{BOOKS[nav.book]} {nav.chapter}</h2>
            <span className="muted">{tid}</span>
          </div>
          <div className="chapters">
            {Array.from({ length: chapterCount }, (_, i) => (
              <button key={i} className={`chip ${nav.chapter === i + 1 ? 'sel' : ''}`} onClick={() => setNav({ book: nav.book, chapter: i + 1 })}>{i + 1}</button>
            ))}
          </div>
          <div className="verses" ref={verseListRef}>
            {loadError && <div className="empty">{loadError}</div>}
            {!bible && !loadError && <div className="empty">Loading Bible…</div>}
            {chapterVerses.map((t, i) => {
              const ref = { book: nav.book, chapter: nav.chapter, verse: i + 1 };
              return (
                <div
                  key={i}
                  className={`verse ${sameRef(ref, preview) ? 'sel' : ''} ${sameRef(ref, live) && mode !== 'black' ? 'is-live' : ''}`}
                  onClick={() => setPreview(ref)}
                  onDoubleClick={() => present(ref)}
                >
                  <span className="vnum">{i + 1}</span>
                  <span className="vtext">{t}</span>
                  <span className="vactions">
                    <button className="mini" title="Add to queue" onClick={(e) => { e.stopPropagation(); addToQueue([ref]); flash('Added to queue'); }}>＋</button>
                    <button className="mini go" title="Present now" onClick={(e) => { e.stopPropagation(); present(ref); }}>▶</button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel livecol">
          <div className="panel-title">Live sermon</div>
          <LivePanel
            hidden={false}
            bible={bible}
            live={live}
            present={present}
            addToQueue={addToQueue}
            onBadge={setLiveBadge}
            onListening={setIsListening}
            flash={flash}
          />
        </section>
      </main>

      <footer className="statusbar">
        <span><kbd>/</kbd> search</span><span><kbd>↑</kbd><kbd>↓</kbd> pick verse</span><span><kbd>Enter</kbd> take</span>
        <span><kbd>→</kbd><kbd>Space</kbd> next</span><span><kbd>B</kbd> black</span><span><kbd>C</kbd> clear</span>
        <div className="spacer" />
        <span className="muted">{isListening ? '● Listening to the sermon' : 'Press Start listening when the sermon begins'}</span>
        {update && (
          <span className="upd">
            {update.state === 'ready' ? (
              <button className="upd-ready" onClick={() => api.updateInstall()}>Update {update.newVersion} ready — restart</button>
            ) : update.state === 'downloading' ? (
              <span>Downloading update {update.newVersion} · {update.percent || 0}%</span>
            ) : (
              <>
                <span>v{update.version}</span>
                <button className="link" title={update.message || ''} onClick={() => api.updateCheck().then(setUpdate)} disabled={update.state === 'checking'}>
                  {update.state === 'checking' ? 'checking…' : update.state === 'latest' ? 'up to date ✓' : update.state === 'error' ? 'check again' : 'check for updates'}
                </button>
              </>
            )}
          </span>
        )}
      </footer>

      {showImport && (
        <ImportBible
          imported={imported}
          onClose={() => setShowImport(false)}
          onImported={async (id) => { setImported(await importedBibles()); setTid(id); setShowImport(false); flash(`${id} imported`); }}
          onRemoved={(list, id) => { setImported(list); if (tid === id) setTid('KJV'); flash(`${id} removed`); }}
        />
      )}

      {showOutputs && (
        <div className="modal-bg" onClick={() => setShowOutputs(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Outputs</h3>
            <section className="out-sec">
              <h4>Projector</h4>
              <p className="muted">Pick the screen at the top, then press <b>GO LIVE</b>. The verse fills that screen.</p>
            </section>

            <section className="out-sec">
              <div className="sec-head">
                <h4>NDI</h4>
                {ndiStatus?.available && <span className="ok-pill">Ready</span>}
              </div>
              {!api ? (
                <p className="muted">Available in the desktop app.</p>
              ) : ndiStatus && !ndiStatus.available ? (
                <div className="notice">
                  <b>NDI isn’t set up in this copy of the app yet.</b>
                  <div>Put <code>Processing.NDI.Lib.x64.dll</code> in the app’s <code>vendor\ndi</code> folder (steps in <code>vendor\ndi\README.txt</code>), then reopen the app. Installers built with <code>npm run dist</code> include it, so church PCs need nothing extra.</div>
                </div>
              ) : (
                <>
                  <p className="muted">Sends the verse over your network to vMix, OBS (with the NDI plugin) or any NDI app. It shows up as <b>{ndiStatus?.machine || 'THIS-PC'} (name)</b>.</p>
                  {['full', 'lower'].map((l) => {
                    const st = ndiStatus?.sources?.[l];
                    return (
                      <div key={l} className="ndi-row">
                        <label className="switch">
                          <input type="checkbox" checked={ndiCfg[l].enabled} onChange={(e) => setNdiSource(l, { enabled: e.target.checked })} />
                          <span />
                        </label>
                        <div className="ndi-info">
                          <div className="ndi-title">{l === 'full' ? 'Full screen' : 'Lower third'} <span className="muted">{l === 'full' ? '· background + verse' : '· see-through, for over camera'}</span></div>
                          <input
                            className="ndi-name"
                            value={ndiNames[l]}
                            onChange={(e) => setNdiNames((n) => ({ ...n, [l]: e.target.value }))}
                            onBlur={() => commitNdiName(l)}
                            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                            maxLength={60}
                          />
                        </div>
                        <div className="ndi-state">
                          {st?.running ? (st.connections ? <span className="live-txt">● {st.connections} watching</span> : <span className="muted">On · waiting</span>) : <span className="muted">Off</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="ndi-row compact">
                    <span className="muted">Frame rate</span>
                    <div className="seg">
                      {[25, 30, 60].map((f) => (
                        <button key={f} className={ndiCfg.fps === f ? 'sel' : ''} onClick={() => setNdiCfg((c) => ({ ...c, fps: f }))}>{f}</button>
                      ))}
                    </div>
                    <span className="muted small">30 is best for this laptop. Video is only sent when someone is watching.</span>
                  </div>
                  {ndiStatus?.error && <div className="notice">{ndiStatus.error}</div>}
                </>
              )}
              <p className="muted small trademark">NDI® is a registered trademark of Vizrt NDI AB. <span className="tm-link">ndi.video</span></p>
            </section>

            <section className="out-sec">
              <button className="link sec-toggle" onClick={() => setShowBrowserSrc((v) => !v)}>
                {showBrowserSrc ? '▾' : '▸'} No NDI? Use a browser source instead
              </button>
              {showBrowserSrc && (api ? (
                webInfo ? (
                  <div className="urls">
                    <p className="muted">In OBS or vMix add a <i>Browser source</i>, size 1920×1080, with one of these addresses (click to copy):</p>
                    {['lower', 'full'].map((l) => (
                      <div key={l} className="url-row">
                        <span className="url-label">{l === 'lower' ? 'Lower third (transparent)' : 'Full screen'}</span>
                        {['localhost', ...webInfo.addresses].map((h) => {
                          const u = `http://${h}:${webInfo.port}/output.html?layout=${l}`;
                          return <code key={h} onClick={() => { navigator.clipboard?.writeText(u); flash('Copied'); }} title="Click to copy">{u}</code>;
                        })}
                      </div>
                    ))}
                  </div>
                ) : <p className="muted">Loading…</p>
              ) : <p className="muted">Available in the desktop app.</p>)}
            </section>

            <div className="row end"><button className="btn primary" onClick={() => setShowOutputs(false)}>Done</button></div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
