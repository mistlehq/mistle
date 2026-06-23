import { z } from "zod";

export const ShopifyTargetSecretSchema = z.object({}).strict();

export type ShopifyTargetSecrets = z.output<typeof ShopifyTargetSecretSchema>;
