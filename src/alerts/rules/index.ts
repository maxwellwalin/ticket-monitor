import type { AlertRule } from "../rule";
import { ticketsAvailableRule } from "./tickets-available";
import { priceBelowRule } from "./price-below";
import { presaleOpeningRule } from "./presale-opening";
import { priceDropRule } from "./price-drop";

export const defaultRules: AlertRule[] = [
  ticketsAvailableRule,
  priceBelowRule,
  presaleOpeningRule,
  priceDropRule,
];

export {
  ticketsAvailableRule,
  priceBelowRule,
  presaleOpeningRule,
  priceDropRule,
};
