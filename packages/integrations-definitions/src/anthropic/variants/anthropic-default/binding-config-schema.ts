import { z } from "zod";

export const AnthropicBindingConfigSchema = z.object({}).strict();

export type AnthropicBindingConfig = z.output<typeof AnthropicBindingConfigSchema>;
