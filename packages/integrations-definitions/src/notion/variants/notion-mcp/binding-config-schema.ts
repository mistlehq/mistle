import { z } from "zod";

import { NotionToolIds } from "./tool-ids.js";

export const NotionBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([NotionToolIds.NOTION_MCP])).default([NotionToolIds.NOTION_MCP]),
  })
  .strict();

export type NotionBindingConfig = z.output<typeof NotionBindingConfigSchema>;
