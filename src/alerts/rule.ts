import type { NormalizedEvent } from "../types";
import type { AlertStatePort, Clock } from "./ports";
import type { AlertCheckContext } from "./ports";

export interface RuleMatch {
  detail: string;
  /** Optional metadata for dedup key generation (e.g., presale name) */
  meta?: Record<string, string>;
}

export interface AlertRule {
  readonly type: string;
  readonly label: string;
  readonly color: string;
  evaluate(
    event: NormalizedEvent,
    ctx: AlertCheckContext,
    state: AlertStatePort,
    clock: Clock
  ): Promise<RuleMatch[]>;
  dedupKey(event: NormalizedEvent, match: RuleMatch, ctx: AlertCheckContext): string;
  renderDetail(alert: {
    event: NormalizedEvent;
    maxPrice: number;
    detail?: string;
  }): string;
  subjectFragment(count: number): string;
  /** Alert types to skip if this rule fires for the same event */
  skipTypes?: string[];
}
