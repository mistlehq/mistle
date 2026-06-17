import { z } from "zod";

export const WhapiApiBaseUrl = "https://gate.whapi.cloud";

export const WhapiTargetConfigSchema = z.object({}).strict();

export type WhapiTargetConfig = z.output<typeof WhapiTargetConfigSchema>;
