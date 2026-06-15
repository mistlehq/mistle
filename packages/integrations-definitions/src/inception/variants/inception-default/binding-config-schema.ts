import { z } from "zod";

export const InceptionBindingConfigSchema = z.object({}).strict();

export type InceptionBindingConfig = z.output<typeof InceptionBindingConfigSchema>;
