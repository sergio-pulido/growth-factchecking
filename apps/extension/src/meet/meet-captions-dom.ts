// Reads Meet's visible captions from the DOM.
//
// Meet ships obfuscated class names that change without notice. The selectors below come from public
// caption readers maintained in 2026 (see docs/specs/meet-captions-capture.md) and are NOT verified by us on a
// live call yet. Everything Meet-specific lives in this file so it can be fixed in one place.
import type { CaptionRow } from './caption-consolidator.js';

/** aria-label of the caption region, localized by Meet. */
const REGION_LABEL = /caption|subt[ií]tulo|legenda|sous-titre|untertitel/i;
const REGION_FALLBACKS = ['div[jsname="tgaKEf"]', 'div[jsname="YSxPC"]'];
const ROW_SELECTOR = 'div[jsname="dsyhDe"], div.CNusmb, div.TBMuR';
const SPEAKER_SELECTOR = 'div.KcIKyf, div.zs7s8d';
const TEXT_SELECTOR = 'div.bh44bd, div.iTTPOb';
/** Controls and icon ligatures rendered inside the region (e.g. "arrow_downward Jump to bottom"). */
const NOISE_SELECTOR = 'button, [role="button"], i, .google-material-icons, .material-icons, .material-symbols-outlined';

/** Speaker-less status lines Meet announces in the caption area. English and Spanish UI. */
const NOTICES = [
  /^(live )?captions (are )?(on|off|turned (on|off))\b/i,
  /^(los )?subt[ií]tulos (est[aá]n )?(activados|desactivados|activos)\b/i,
  /\b(has joined|joined|has left( the meeting)?|left the meeting)\.?$/i,
  /\b(se ha unido|se ha unido a la llamada|ha salido( de la reuni[oó]n)?|ha abandonado la reuni[oó]n)\.?$/i,
  /^your (microphone|camera|mic) is (off|on)\b/i,
  /^tu (micr[oó]fono|c[aá]mara) est[aá] (desactivad[oa]|activad[oa])\b/i,
  /^you have joined the call/i,
  /^te has unido a la llamada/i,
  /jump to bottom|ir al final|ir a lo m[aá]s reciente/i,
];

export function isNotice(text: string): boolean {
  return NOTICES.some((pattern) => pattern.test(text.trim()));
}

function cleanText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const noise of Array.from(copy.querySelectorAll(NOISE_SELECTOR))) noise.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function findCaptionRegion(root: ParentNode): Element | null {
  for (const region of Array.from(root.querySelectorAll('[role="region"][aria-label]'))) {
    if (REGION_LABEL.test(region.getAttribute('aria-label') ?? '')) return region;
  }
  for (const selector of REGION_FALLBACKS) {
    const region = root.querySelector(selector);
    if (region) return region;
  }
  return null;
}

/**
 * Visible caption rows, oldest first. Returns null when there is no caption region (captions are off or
 * the layout is unknown). A row without a speaker element keeps an empty speaker.
 */
export function readCaptionRows(root: ParentNode): CaptionRow[] | null {
  const region = findCaptionRegion(root);
  if (!region) return null;

  const rows = Array.from(region.querySelectorAll(ROW_SELECTOR)).filter(
    // Nested matches (a row inside a row) would be read twice.
    (row, _i, all) => !all.some((other) => other !== row && other.contains(row)),
  );

  if (rows.length === 0) {
    // Unknown layout: keep the last non-notice line, without a speaker.
    const blocks = region.children.length > 0 ? Array.from(region.children) : [region];
    const last = blocks.map(cleanText).filter((l) => l && !isNotice(l)).pop();
    return last ? [{ speaker: '', text: last }] : [];
  }

  const result: CaptionRow[] = [];
  for (const row of rows) {
    const speakerEl = row.querySelector(SPEAKER_SELECTOR);
    const textEl = row.querySelector(TEXT_SELECTOR);
    const speaker = speakerEl ? cleanText(speakerEl) : '';
    let text = textEl ? cleanText(textEl) : cleanText(row);
    if (!textEl && speaker && text.startsWith(speaker)) text = text.slice(speaker.length).trim();
    if (!text) continue;
    if (!speaker && isNotice(text)) continue;
    result.push({ speaker, text });
  }
  return result;
}
