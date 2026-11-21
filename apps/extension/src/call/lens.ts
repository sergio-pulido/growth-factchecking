// SVG filter for the liquid-glass edge refraction, used by `backdrop-filter: url(#gf-lens)` in call.css.
// A displacement map shifts the backdrop near each edge (red channel sideways, green up and down), so whatever
// sits behind the glass bends at the rim like light through a thick lens, while the middle stays flat.
// The map is a PNG drawn on a canvas: Chrome does not load SVG images in a backdrop filter's feImage.

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_SIZE = 128;
/** Share of each side that bends; the rest of the glass is flat. */
const EDGE = 0.2;
/** Strongest shift, as a share of the element's width or height. */
const STRENGTH = 0.16;

function displacementMap(): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return '';
  // 128 is "no shift". Towards each edge the value eases away from 128, like the slope of a rounded rim.
  const value = (t: number) => {
    if (t < EDGE) return 128 - 128 * (1 - t / EDGE) ** 2;
    if (t > 1 - EDGE) return 128 + 127 * ((t - (1 - EDGE)) / EDGE) ** 2;
    return 128;
  };
  const image = context.createImageData(MAP_SIZE, MAP_SIZE);
  for (let row = 0; row < MAP_SIZE; row++) {
    for (let column = 0; column < MAP_SIZE; column++) {
      const index = (row * MAP_SIZE + column) * 4;
      image.data[index] = value(column / (MAP_SIZE - 1));
      image.data[index + 1] = value(row / (MAP_SIZE - 1));
      image.data[index + 2] = 128;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export function lensFilter(): SVGSVGElement {
  const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  const svg = make('svg', { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute' });
  // Units relative to each element's box, so one map fits the pill, the panel and every bubble.
  const filter = make('filter', {
    id: 'gf-lens', x: '0', y: '0', width: '1', height: '1',
    primitiveUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB',
  });
  filter.append(
    make('feImage', {
      href: displacementMap(), x: '0', y: '0', width: '1', height: '1', preserveAspectRatio: 'none', result: 'map',
    }),
    make('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'map', scale: String(STRENGTH), xChannelSelector: 'R', yChannelSelector: 'G',
    }),
  );
  svg.append(filter);
  return svg;
}
