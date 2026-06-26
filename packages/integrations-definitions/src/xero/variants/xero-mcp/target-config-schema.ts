import { z } from "zod";

export const XeroApiBaseUrl = "https://api.xero.com";

export const XeroTargetConfigSchema = z.object({}).strict();

export type XeroTargetConfig = z.output<typeof XeroTargetConfigSchema>;
