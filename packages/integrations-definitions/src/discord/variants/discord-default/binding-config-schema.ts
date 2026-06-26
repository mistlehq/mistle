import { z } from "zod";

import { DiscordToolIds } from "./tool-ids.js";

const DiscordToolSchema = z.enum([DiscordToolIds.DISCORD_CLI, DiscordToolIds.DISCORD_MCP]);

export const DiscordBindingConfigSchema = z
  .object({
    tools: z.array(DiscordToolSchema).default([]),
  })
  .strict();

export type DiscordBindingConfig = z.output<typeof DiscordBindingConfigSchema>;
