import { z } from "zod";

export const ShopifyTargetConfigSchema = z.object({}).strict();

export type ShopifyTargetConfig = z.output<typeof ShopifyTargetConfigSchema>;
