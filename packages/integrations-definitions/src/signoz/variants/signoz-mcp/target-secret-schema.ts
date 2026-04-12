import { z } from "zod";

export const SignozTargetSecretSchema = z.object({}).strict();

export type SignozTargetSecret = z.output<typeof SignozTargetSecretSchema>;
