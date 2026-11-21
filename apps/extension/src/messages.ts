import type { CaptureMethod, DemoScenario, FactCheckRequest, FactCheckResult, UtteranceInput } from '@growth-factcheking/shared';
import type { TransportErrorCode } from './call/types.js';

export type FactCheckMode = 'mock' | 'live';
export type FactCheckMessage = FactCheckRequest & (
  | { mode: 'mock'; scenario: DemoScenario }
  | { mode: 'live' }
);

export type LocalResponse<Result> =
  | { ok: true; result: Result }
  | { ok: false; message: string };

export type FactCheckResponse = LocalResponse<{ check: FactCheckResult; mode: FactCheckMode }>;

/** Calls from the call overlay (content script) to the background worker. */
export type CallRequest =
  | { kind: 'call-start'; platform: string; capture: CaptureMethod; title?: string; pageUrl?: string }
  | { kind: 'call-send'; id: string; utterances: UtteranceInput[] }
  | { kind: 'call-end'; id: string }
  | { kind: 'call-remove'; id: string }
  | { kind: 'call-recheck'; claim: string }
  | { kind: 'call-claims'; id: string }
  | { kind: 'call-badge'; count: number }
  | { kind: 'audio-start'; language?: string }
  | { kind: 'audio-pause' }
  | { kind: 'audio-resume' }
  | { kind: 'audio-stop' };

export type CallReply =
  | { ok: true; result: unknown }
  | { ok: false; message: string; code: TransportErrorCode };

/** Background worker -> overlay in a tab. */
export type TabEvent =
  | { kind: 'call-toggle' }
  | { kind: 'audio-delta'; itemId: string; text: string }
  | { kind: 'audio-segment'; itemId: string; text: string }
  | { kind: 'audio-error'; message: string };

/** Background worker <-> offscreen document that holds the tab audio stream. */
export type OffscreenCommand =
  | { target: 'offscreen'; kind: 'start'; streamId: string; token: string }
  | { target: 'offscreen'; kind: 'pause' | 'resume' | 'stop' };

export type OffscreenEvent =
  | { source: 'offscreen'; kind: 'delta'; itemId: string; text: string }
  | { source: 'offscreen'; kind: 'segment'; itemId: string; text: string }
  | { source: 'offscreen'; kind: 'error'; message: string }
  | { source: 'offscreen'; kind: 'token-needed' };

export type DemoPostsRequest = { kind: 'x-demo-posts' };
export type DemoPostsResponse = { postIds: string[] };
export type FaviconRequest = { kind: 'favicon'; host: string };
export type FaviconResponse = { dataUrl?: string };

/** An approved news article and the sentences on it to check; no sentences means automatic picks. */
export type NewsArticle = { url: string; claims: string[] };
export type NewsArticlesRequest = { kind: 'news-demo-articles' };
export type NewsArticlesResponse = { articles: NewsArticle[] };
