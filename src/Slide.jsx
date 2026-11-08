import { useLayoutEffect, useRef, useState } from 'react';
import { FONTS } from './themes.js';

const W = 1920;
const H = 1080;

/** Scales a 1920×1080 stage to fit its parent box. */
export function Stage({ children, transparent = false }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0.1);
  useLayoutEffect(() => {
    const el = box.current;
    const fit = () => setScale(Math.min(el.clientWidth / W, el.clientHeight / H) || 0.1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="stage-box" style={{ background: transparent ? 'transparent' : '#000' }}>
      <div className="stage" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** Shrinks font size until the text fits its box. */
function FitText({ text, max, min, style, className }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s = max;
    el.style.fontSize = `${s}px`;
    while (s > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
      s -= 2;
      el.style.fontSize = `${s}px`;
    }
    setSize(s);
  }, [text, max, min, style?.fontFamily]);
  return (
    <div ref={ref} className={className} style={{ ...style, fontSize: size }}>
      {text}
    </div>
  );
}

function Background({ theme }) {
  return (
    <>
      <div className="bg" style={{ background: theme.background }} />
      {theme.image && (
        <>
          <div className="bg" style={{ backgroundImage: `url(${theme.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          <div className="bg" style={{ background: `rgba(0,0,0,${theme.dim ?? 0.45})` }} />
        </>
      )}
    </>
  );
}

/**
 * state: { mode: 'live'|'black'|'clear', slide: {text, ref, translation} | null }
 * layout: 'full' (projector) or 'lower' (lower third for livestream, transparent)
 */
export function Slide({ state, theme, layout = 'full' }) {
  const mode = state?.mode ?? 'clear';
  const slide = state?.slide;
  const showText = mode === 'live' && slide?.text;
  const font = FONTS[theme.font] || FONTS.sans;
  const shadow = theme.shadow === false ? 'none' : '0 3px 18px rgba(0,0,0,.55)';
  const refText = slide ? `${slide.ref}${slide.translation ? ` (${slide.translation})` : ''}` : '';

  if (layout === 'lower') {
    if (!showText) return null;
    return (
      <div className="lt fade" key={refText + slide.text}>
        <div className="lt-bar" style={{ borderLeftColor: theme.refColor }}>
          <div className="lt-ref" style={{ color: theme.refColor, fontFamily: FONTS.sans }}>{refText}</div>
          <FitText className="lt-text" text={slide.text} max={50} min={26} style={{ fontFamily: font }} />
          {slide.attribution && <div className="lt-attr">{slide.attribution}</div>}
        </div>
      </div>
    );
  }

  if (mode === 'black') return <div className="bg" style={{ background: '#000' }} />;

  return (
    <>
      <Background theme={theme} />
      {showText && (
        <div className="full fade" key={refText + slide.text}>
          <FitText
            className="full-text"
            text={slide.text}
            max={92}
            min={34}
            style={{ fontFamily: font, color: theme.textColor, textShadow: shadow }}
          />
          <div className="full-ref" style={{ color: theme.refColor, fontFamily: FONTS.sans, textShadow: shadow }}>{refText}</div>
        </div>
      )}
      {showText && slide.attribution && (
        <div className="attribution" style={{ color: theme.textColor, fontFamily: FONTS.sans }}>{slide.attribution}</div>
      )}
    </>
  );
}
