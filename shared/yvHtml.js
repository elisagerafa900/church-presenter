// Splits a YouVersion chapter (HTML from the passages endpoint) into verses.
// Verse starts are marked with <span class="yv-v" v="16"> (milestone or wrapper);
// labels (.yv-vlbl / .va), notes (.yv-n) and headings (.yv-h, .s1 …) are skipped.
const SKIP = '.yv-n, .yv-vlbl, .va, .yv-h, .s, .s1, .s2, .s3, .s4, .ms, .ms1, .ms2, .ms3, .mr, .sp, .sr, .r, .qa, .d, .cl, .note, .label, .heading, sup';

/** @param {Document} doc parsed HTML  @returns {Map<number,string>} verse -> text */
export function versesFromDoc(doc) {
  const out = new Map();
  let current = null;
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        const el = child;
        if (el.matches?.('.yv-v[v]')) {
          const n = parseInt(el.getAttribute('v'), 10);
          if (n) current = n;
        }
        if (el.matches?.(SKIP)) continue;
        walk(el);
      } else if (child.nodeType === 3 && current) {
        out.set(current, (out.get(current) || '') + child.nodeValue);
      }
    }
  };
  walk(doc.body || doc);
  for (const [k, v] of out) out.set(k, v.replace(/\s+/g, ' ').replace(/\s+([,.;:!?’”)])/g, '$1').trim());
  return out;
}

/** Plain-text copyright line from a YouVersion version record. */
export function attributionText(v) {
  const raw = v?.copyright || v?.promo || '';
  return raw.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}
