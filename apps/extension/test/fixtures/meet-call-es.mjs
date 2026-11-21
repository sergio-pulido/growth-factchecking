// Scripted Spanish Meet call between an investor and a founder, as successive caption snapshots.
// It reproduces how Meet rewrites captions: growth, a corrected word (non-prefix rewrite), a shorter redraw,
// a pause inside the same caption block, and older blocks scrolling out of view.
// The company and its figures are fictional (see data/demo/meet-startup.json).

export const INVESTOR = 'Laura Gómez';
export const FOUNDER = 'Marc Puig';

const L = (text) => ({ speaker: INVESTOR, text });
const M = (text) => ({ speaker: FOUNDER, text });

const GREETING = 'Hola Marc, gracias por venir.';
const QUESTION = '¿Cuántos ingresos recurrentes tenéis al mes?';
const FOUNDED = 'Fundamos Lumen Labs en 2021 en Barcelona.';
const REVENUE = 'En octubre cerramos con 50.000 euros de ingresos recurrentes mensuales.';
const OPINION = 'Me parece un equipo muy sólido.';

/** Snapshots of the visible caption rows. `at` is milliseconds since the call started. */
export const STEPS = [
  { at: 0, rows: [L('Hola')] },
  { at: 400, rows: [L('Hola Marc,')] },
  { at: 900, rows: [L('Hola Marc, gracias por')] },
  { at: 1300, rows: [L(GREETING)] },
  // Pause longer than idleCommitMs inside the same block: the greeting is final on its own.
  { at: 6000, rows: [L(GREETING)] },
  { at: 6400, rows: [L(`${GREETING} ¿Cuántos ingresos`)] },
  { at: 6900, rows: [L(`${GREETING} ¿Cuántos ingresos recurrentes tenéis`)] },
  { at: 7400, rows: [L(`${GREETING} ${QUESTION}`)] },
  { at: 8200, rows: [L(`${GREETING} ${QUESTION}`), M('Fundamos')] },
  { at: 8600, rows: [L(`${GREETING} ${QUESTION}`), M('Fundamos Lumen Labs en 2020')] },
  // Meet corrects a recognized word: not a prefix of the previous text.
  { at: 9200, rows: [L(`${GREETING} ${QUESTION}`), M('Fundamos Lumen Labs en 2021 en')] },
  { at: 9700, rows: [L(`${GREETING} ${QUESTION}`), M(FOUNDED)] },
  // Shorter redraw of the same caption: the fuller text must be kept.
  { at: 10_100, rows: [L(`${GREETING} ${QUESTION}`), M('Fundamos Lumen Labs en 2021')] },
  { at: 10_500, rows: [L(`${GREETING} ${QUESTION}`), M(FOUNDED)] },
  { at: 11_200, rows: [M(FOUNDED), M('En octubre cerramos')] },
  { at: 11_700, rows: [M(FOUNDED), M('En octubre cerramos con 50.000 euros')] },
  { at: 12_300, rows: [M(FOUNDED), M('En octubre cerramos con 50.000 euros de ingresos recurrentes')] },
  { at: 12_800, rows: [M(FOUNDED), M(REVENUE)] },
  { at: 13_600, rows: [M(REVENUE), L('Me parece')] },
  { at: 14_000, rows: [M(REVENUE), L('Me parece un equipo')] },
  { at: 14_500, rows: [M(REVENUE), L(OPINION)] },
  { at: 16_500, rows: [L(OPINION)] },
];

/** Final utterances expected, in order. */
export const EXPECTED = [
  { speaker: INVESTOR, text: GREETING },
  { speaker: INVESTOR, text: QUESTION },
  { speaker: FOUNDER, text: FOUNDED },
  { speaker: FOUNDER, text: REVENUE },
  { speaker: INVESTOR, text: OPINION },
];

export const CLAIMS = { supported: FOUNDED, contradicted: REVENUE, opinion: OPINION };
