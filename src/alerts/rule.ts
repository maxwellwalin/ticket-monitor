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
  readonly priority: number;
  readonly dedupNamespace: string;
  readonly suppresses?: string[];
  dedupDiscriminator?(event: NormalizedEvent, match: RuleMatch, ctx: AlertCheckContext): string;
  evaluate(
    event: NormalizedEvent,
    ctx: AlertCheckContext,
    state: AlertStatePort,
    clock: Clock
  ): Promise<RuleMatch[]>;
  renderDetail(alert: {
    event: NormalizedEvent;
    maxPrice: number;
    detail?: string;
  }): string;
  subjectFragment(count: number): string;
}
