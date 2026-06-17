import { z } from "zod";

export const GoogleWorkspaceTargetSecretSchema = z.object({}).strict();

export type GoogleWorkspaceTargetSecrets = z.output<typeof GoogleWorkspaceTargetSecretSchema>;
