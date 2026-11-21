import { articleStatusId, isXBookmarks, isXHome, isXPost, startInlineFeed } from './inline-feed.js';

// Automatically check only the demo selection in Bookmarks.
const demoPostIds = new Set([
  '2124073885545148489', // Bank tax announcement
  '2123743331163467835', // Atenea voting guide
  '2123944095307735258', // Tesla store opening
  '2123672699490775306', // Barcelona rental contracts
  '2123741212414738719', // CERA deadline
]);

function isPoliticsFeed() {
  if (!isXHome()) return false;
  return Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).some(
    (tab) => /^(politics|política)$/iu.test(tab.textContent?.trim() ?? ''),
  );
}

function canStart() {
  return isPoliticsFeed() || isXPost() || isXBookmarks();
}

const observer = new MutationObserver(activate);
function activate() {
  if (!canStart()) return;
  observer.disconnect();
  startInlineFeed({
    available: canStart,
    accepts: (article) => !isXBookmarks() || demoPostIds.has(articleStatusId(article) ?? ''),
  });
}

observer.observe(document.body, {
  attributes: true,
  attributeFilter: ['aria-selected'],
  characterData: true,
  childList: true,
  subtree: true,
});
activate();
