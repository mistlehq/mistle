import { z } from "zod";

import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

const GoogleSearchConsoleToolSchema = z.enum([
  GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI,
  GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
]);

export const GoogleSearchConsoleBindingConfigSchema = z
  .object({
    tools: z.array(GoogleSearchConsoleToolSchema).default([]),
  })
  .strict();

export type GoogleSearchConsoleBindingConfig = z.output<
  typeof GoogleSearchConsoleBindingConfigSchema
>;
