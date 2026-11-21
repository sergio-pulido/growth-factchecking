import { FACT_CHECK_PATH } from '@growth-factcheking/shared';
import type { FactCheckResult } from '@growth-factcheking/shared';
import { startInlineFeed } from './inline-feed.js';

startInlineFeed({
  available: () => location.pathname === '/x-demo',
  request: async (claim) => {
    const response = await fetch(`${FACT_CHECK_PATH}/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok && response.headers.get('X-Fact-Check-Mode') === 'live') {
      return await response.json() as FactCheckResult;
    }
  },
  favicon: async (host) => {
    const response = await fetch(`/api/favicon?host=${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) return URL.createObjectURL(await response.blob());
  },
});
