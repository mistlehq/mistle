import { z } from "zod";

export const GoogleSearchConsoleTargetSecretSchema = z.object({}).strict();

export type GoogleSearchConsoleTargetSecrets = z.output<
  typeof GoogleSearchConsoleTargetSecretSchema
>;
