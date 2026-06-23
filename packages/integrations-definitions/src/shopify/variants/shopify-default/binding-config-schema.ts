import { z } from "zod";

import { ShopifyToolIds } from "./tool-ids.js";

const ShopifyToolSchema = z.enum([ShopifyToolIds.SHOPIFY_CLI, ShopifyToolIds.SHOPIFY_MCP]);

export const ShopifyBindingConfigSchema = z
  .object({
    tools: z.array(ShopifyToolSchema).default([]),
  })
  .strict();

export type ShopifyBindingConfig = z.output<typeof ShopifyBindingConfigSchema>;
