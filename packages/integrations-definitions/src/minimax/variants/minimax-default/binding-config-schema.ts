import { z } from "zod";

export const MiniMaxBindingConfigSchema = z.object({}).strict();

export type MiniMaxBindingConfig = z.output<typeof MiniMaxBindingConfigSchema>;
