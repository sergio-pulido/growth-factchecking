// Dotted "thinking" orb shown in the pill's logo while claims are being checked.
// A sphere of dots that turns and breathes, drawn on a canvas; animates only while running.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export type Orb = {
  element: HTMLCanvasElement;
  setRunning(running: boolean): void;
};

export function createOrb(size: number): Orb {
  const canvas = document.createElement('canvas');
  canvas.className = 'orb';
  canvas.setAttribute('aria-hidden', 'true');
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = canvas.height = Math.round(size * ratio);
  canvas.style.width = canvas.style.height = `${size}px`;
  const context = canvas.getContext('2d');
  // Fewer dots when small, so the sphere still reads at pill size.
  const DOTS = size < 40 ? 64 : 160;

  // Fibonacci sphere: evenly spread points, each with its own breathing phase.
  const points = Array.from({ length: DOTS }, (_, index) => {
    const y = 1 - (index / (DOTS - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const angle = index * GOLDEN;
    return { x: Math.cos(angle) * ring, y, z: Math.sin(angle) * ring, phase: (index * 2.399) % (Math.PI * 2) };
  });

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let frame = 0;
  let running = false;
  let started = 0;

  function draw(time: number) {
    if (!context) return;
    const t = (time - started) / 1000;
    const half = canvas.width / 2;
    const radius = half * 0.62;
    const spin = t * 1.1;
    const tilt = 0.45 + Math.sin(t * 0.7) * 0.15;
    const [sinSpin, cosSpin, sinTilt, cosTilt] = [Math.sin(spin), Math.cos(spin), Math.sin(tilt), Math.cos(tilt)];
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    for (const point of points) {
      // Turn around the vertical axis, then lean towards the viewer.
      const x = point.x * cosSpin + point.z * sinSpin;
      const z1 = -point.x * sinSpin + point.z * cosSpin;
      const y = point.y * cosTilt - z1 * sinTilt;
      const z = point.y * sinTilt + z1 * cosTilt;
      const breathe = 1 + 0.12 * Math.sin(t * 3.2 + point.phase) * Math.sin(t * 1.3);
      const depth = (z + 1) / 2;
      context.globalAlpha = 0.18 + depth * 0.82;
      context.beginPath();
      context.arc(half + x * radius * breathe, half + y * radius * breathe, (0.45 + depth * 0.75) * ratio, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function loop(time: number) {
    draw(time);
    frame = running && !reduced ? requestAnimationFrame(loop) : 0;
  }

  return {
    element: canvas,
    setRunning(next) {
      if (next === running) return;
      running = next;
      if (running && !frame) {
        started = performance.now();
        frame = requestAnimationFrame(loop);
      } else if (!running && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
  };
}
