import { z } from "zod";

export const XeroTargetSecretSchema = z.object({}).strict();

export type XeroTargetSecret = z.output<typeof XeroTargetSecretSchema>;
