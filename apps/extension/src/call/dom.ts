// Small DOM builders. Call apps such as Meet enforce Trusted Types, so the panel never assigns innerHTML.
type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | null | undefined | false;

export function h<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';

type IconSpec = { size: number; paths: string[]; fill?: boolean; stroke?: number };

const ICONS = {
  check: { size: 13, paths: ['M5 12.5l4.5 4.5L19 7.5'], stroke: 3 },
  pause: { size: 12, paths: ['M6 5h4.2v14H6z', 'M13.8 5H18v14h-4.2z'], fill: true },
  play: { size: 12, paths: ['M8 5.5v13a1 1 0 001.5.86l10.4-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z'], fill: true },
  stop: { size: 11, paths: ['M5 5h14v14H5z'], fill: true },
  mic: { size: 16, paths: ['M9 6a3 3 0 016 0v5a3 3 0 01-6 0z', 'M5 11a7 7 0 0014 0M12 18v3'], stroke: 2 },
  minimize: { size: 16, paths: ['M6 12h12'], stroke: 2 },
  chevron: { size: 14, paths: ['M6 9l6 6 6-6'], stroke: 2.4 },
  close: { size: 10, paths: ['M6 6l12 12M18 6L6 18'], stroke: 3 },
  search: { size: 12, paths: ['M4.5 11a6.5 6.5 0 1013 0 6.5 6.5 0 00-13 0', 'M16 16l4.5 4.5'], stroke: 2.4 },
} satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, color = 'currentColor'): SVGSVGElement {
  const spec: IconSpec = ICONS[name];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(spec.size));
  svg.setAttribute('height', String(spec.size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', spec.fill ? color : 'none');
  if (!spec.fill) {
    svg.setAttribute('stroke', color);
    svg.setAttribute('stroke-width', String(spec.stroke ?? 2));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const d of spec.paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
