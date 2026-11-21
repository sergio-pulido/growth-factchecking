// Reads Meet's visible captions from the DOM.
//
// Meet-specific selectors are scoped to its caption region. See the capture spec for layouts used in tests.
import type { CaptionRow } from './caption-consolidator.js';

/** aria-label of the caption region, localized by Meet. */
const REGION_LABEL = /caption|subt[ií]tulo|legenda|sous-titre|untertitel/i;
const REGION_FALLBACKS = ['div[jsname="tgaKEf"]', 'div[jsname="YSxPC"]'];
const ROW_SELECTOR = 'div[jsname="dsyhDe"], div.CNusmb, div.TBMuR, div.nMcdL.bj4p3b';
const SPEAKER_SELECTOR = '.KcIKyf, .zs7s8d, .NWpY1d';
const TEXT_SELECTOR = '.bh44bd, .iTTPOb, .ygicle.VbkSUe';
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

function findCaptionRows(region: Element): Element[] {
  const identified = new Set<Element>();
  for (const text of Array.from(region.querySelectorAll(TEXT_SELECTOR))) {
    // Recover a row when Meet changes the wrapper class. Stop before combining text from different speakers.
    for (let row = text.parentElement; row && row !== region; row = row.parentElement) {
      if (row.querySelectorAll(TEXT_SELECTOR).length > 1) break;
      const speakers = row.querySelectorAll(SPEAKER_SELECTOR);
      if (speakers.length > 1) break;
      if (speakers.length === 1) {
        identified.add(row);
        break;
      }
    }
  }

  // Keep the named pair when its body is also matched by a known row selector.
  const pairs = Array.from(identified);
  const known = Array.from(region.querySelectorAll(ROW_SELECTOR));
  const remaining = known.filter((row) => !pairs.some((pair) => pair.contains(row) || row.contains(pair))
    && !known.some((other) => other !== row && row.contains(other)));
  return [...pairs, ...remaining]
    .sort((a, b) => a.compareDocumentPosition(b) & a.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

/** Visible caption rows, oldest first. Returns null when the caption markup is absent. */
export function readCaptionRows(root: Document, pictureInPicture = false): CaptionRow[] | null {
  // The floating window can render the same caption fields without the labelled full-page region.
  const region = findCaptionRegion(root) ?? (pictureInPicture && root.body?.querySelector(TEXT_SELECTOR) ? root.body : null);
  if (!region) return null;

  const rows = findCaptionRows(region);

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
