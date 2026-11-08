// Output page: used by the projector window (Electron) and by OBS/vMix
// as a browser source: http://<this-pc>:4317/output.html?layout=lower
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Slide, Stage } from './Slide.jsx';
import { BUILTIN_THEMES } from './themes.js';
import './styles.css';

const params = new URLSearchParams(location.search);
const layout = params.get('layout') === 'lower' ? 'lower' : 'full';

function Output() {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (window.presenter?.isElectron) return window.presenter.onState(setState);
    // Browser source: live updates over Server-Sent Events.
    const es = new EventSource('/events');
    es.onmessage = (e) => setState(JSON.parse(e.data));
    return () => es.close();
  }, []);
  const theme = state?.theme || BUILTIN_THEMES[0];
  return (
    <div className="output-root" style={{ background: layout === 'lower' ? 'transparent' : '#000' }}>
      <Stage transparent={layout === 'lower'}>
        <Slide state={state} theme={theme} layout={layout} />
      </Stage>
    </div>
  );
}

document.body.style.cursor = 'none';
// The operator stylesheet paints a dark page; outputs must be black or fully transparent.
const pageBg = layout === 'lower' ? 'transparent' : '#000';
document.documentElement.style.background = pageBg;
document.body.style.background = pageBg;
createRoot(document.getElementById('root')).render(<Output />);
