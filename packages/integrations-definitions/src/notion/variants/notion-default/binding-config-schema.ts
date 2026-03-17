import { z } from "zod";

export const NotionBindingConfigSchema = z.object({}).strict();

export type NotionBindingConfig = z.output<typeof NotionBindingConfigSchema>;
