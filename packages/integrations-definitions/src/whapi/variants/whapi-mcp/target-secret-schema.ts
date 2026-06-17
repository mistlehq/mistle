import { z } from "zod";

export const WhapiTargetSecretSchema = z.object({}).strict();

export type WhapiTargetSecret = z.output<typeof WhapiTargetSecretSchema>;
