import { articleStatusId, isXBookmarks, isXHome, isXPost, startInlineFeed } from './inline-feed.js';

import type { DemoPostsRequest, DemoPostsResponse } from './messages.js';

let demoPostIds: Set<string> | undefined;
let loadingCatalog = false;

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
  if (!demoPostIds) {
    if (!loadingCatalog) {
      loadingCatalog = true;
      void chrome.runtime.sendMessage<DemoPostsRequest, DemoPostsResponse>({ kind: 'x-demo-posts' })
        .then((result) => { demoPostIds = new Set(result?.postIds); })
        .catch(() => { demoPostIds = new Set(); })
        .finally(activate);
    }
    return;
  }
  const approved = demoPostIds;
  observer.disconnect();
  startInlineFeed({
    available: canStart,
    accepts: (article) => !isXBookmarks() || approved.has(articleStatusId(article) ?? ''),
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
