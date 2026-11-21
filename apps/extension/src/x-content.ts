import { isXHome, startInlineFeed } from './inline-feed.js';

function isPoliticsFeed() {
  if (!isXHome()) return false;
  return Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).some(
    (tab) => /^(politics|política)$/iu.test(tab.textContent?.trim() ?? ''),
  );
}

const observer = new MutationObserver(activate);
function activate() {
  if (!isPoliticsFeed()) return;
  observer.disconnect();
  startInlineFeed({ available: isPoliticsFeed });
}

observer.observe(document.body, {
  attributes: true,
  attributeFilter: ['aria-selected'],
  characterData: true,
  childList: true,
  subtree: true,
});
activate();
