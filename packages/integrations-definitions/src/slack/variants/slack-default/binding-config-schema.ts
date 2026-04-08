import { z } from "zod";

import { SlackToolIds } from "./tool-ids.js";

const SlackToolSchema = z.enum([SlackToolIds.SLACK_CLI]);

export const SlackBindingConfigSchema = z
  .object({
    tools: z.array(SlackToolSchema).default([]),
  })
  .strict();

export type SlackBindingConfig = z.output<typeof SlackBindingConfigSchema>;
