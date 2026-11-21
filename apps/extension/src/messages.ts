import type { DemoScenario, FactCheckRequest, FactCheckResult, MeetCheckRequest, MeetCheckResult } from '@growth-factcheking/shared';

export type DemoRequest = FactCheckRequest & { scenario: DemoScenario };

export type LocalResponse<Result> =
  | { ok: true; result: Result }
  | { ok: false; message: string };

export type DemoResponse = LocalResponse<FactCheckResult>;
export type MeetDemoRequest = MeetCheckRequest & { kind: 'meet-check' };
export type MeetDemoResponse = LocalResponse<MeetCheckResult>;
