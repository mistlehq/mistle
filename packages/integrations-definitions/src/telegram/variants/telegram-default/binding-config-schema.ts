import { z } from "zod";

import { TelegramToolIds } from "./tool-ids.js";

const TelegramToolSchema = z.enum([TelegramToolIds.TELEGRAM_CLI, TelegramToolIds.TELEGRAM_MCP]);

export const TelegramBindingConfigSchema = z
  .object({
    tools: z.array(TelegramToolSchema).default([]),
  })
  .strict();

export type TelegramBindingConfig = z.output<typeof TelegramBindingConfigSchema>;
