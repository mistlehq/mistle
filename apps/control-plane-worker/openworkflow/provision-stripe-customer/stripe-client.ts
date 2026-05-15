import Stripe from "stripe";

export function createStripeBillingClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
}
