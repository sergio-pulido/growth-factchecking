import { CLAIM_MAX_LENGTH } from '@growth-factcheking/shared';
import styles from './overlay.css';

declare global {
  interface Window {
    growthFactCheckingOverlay?: HTMLElement;
  }
}

function mountOverlay() {
  const selection = window.getSelection()?.toString().trim().slice(0, CLAIM_MAX_LENGTH);
  window.growthFactCheckingOverlay?.remove();

  const host = document.createElement('div');
  host.id = 'growth-factchecking-overlay';
  const shadow = host.attachShadow({ mode: 'closed' });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(styles);
  shadow.adoptedStyleSheets = [stylesheet];

  const panel = document.createElement('section');
  const title = document.createElement('h2');
  title.id = 'factchecking-title';
  title.textContent = 'FactChecking';
  panel.setAttribute('aria-labelledby', title.id);

  const header = document.createElement('header');
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar');
  close.textContent = '×';
  header.append(title, close);
  panel.append(header);

  if (selection) {
    const claim = document.createElement('blockquote');
    claim.textContent = selection;
    panel.append(claim);
  }

  const status = document.createElement('p');
  status.textContent = 'Verificación pendiente de conectar.';
  panel.append(status);

  const previousFocus = document.activeElement;
  function dismiss() {
    host.remove();
    window.growthFactCheckingOverlay = undefined;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }

  close.addEventListener('click', dismiss);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismiss();
  });

  window.growthFactCheckingOverlay = host;
  shadow.append(panel);
  document.documentElement.append(host);
  close.focus();
}

mountOverlay();
