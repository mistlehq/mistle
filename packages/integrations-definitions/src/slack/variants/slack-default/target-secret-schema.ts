import { z } from "zod";

export const SlackTargetSecretSchema = z.object({}).strict();

export type SlackTargetSecrets = z.output<typeof SlackTargetSecretSchema>;
