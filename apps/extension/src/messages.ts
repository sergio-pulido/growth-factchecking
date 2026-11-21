import type { DemoScenario, FactCheckRequest, FactCheckResult } from '@growth-factcheking/shared';

export type DemoRequest = FactCheckRequest & { scenario: DemoScenario };

export type DemoResponse =
  | { ok: true; result: FactCheckResult }
  | { ok: false; message: string };
