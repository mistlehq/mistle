import Stripe from "stripe";

export type CreateStripeBillingClientInput = {
  secretKey: string;
};

export function createStripeBillingClient(input: CreateStripeBillingClientInput): Stripe {
  return new Stripe(input.secretKey, {
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
}
