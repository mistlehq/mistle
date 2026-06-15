import { z } from "zod";

export const ResendTargetSecretSchema = z.object({}).strict();

export type ResendTargetSecret = z.output<typeof ResendTargetSecretSchema>;
