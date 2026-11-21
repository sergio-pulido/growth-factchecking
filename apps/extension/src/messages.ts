import type { DemoScenario, FactCheckRequest, FactCheckResult, MeetCheckRequest, MeetCheckResult } from '@growth-factcheking/shared';

export type FactCheckMode = 'mock' | 'live';
export type FactCheckMessage = FactCheckRequest & (
  | { mode: 'mock'; scenario: DemoScenario }
  | { mode: 'live' }
);

export type LocalResponse<Result> =
  | { ok: true; result: Result }
  | { ok: false; message: string };

export type FactCheckResponse = LocalResponse<{ check: FactCheckResult; mode: FactCheckMode }>;
export type MeetDemoRequest = MeetCheckRequest & { kind: 'meet-check' };
export type MeetDemoResponse = LocalResponse<MeetCheckResult>;

export type DemoPostsRequest = { kind: 'x-demo-posts' };
export type DemoPostsResponse = { postIds: string[] };
