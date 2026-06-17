import { z } from "zod";

export const GoogleWorkspaceTargetConfigSchema = z.object({}).strict();

export type GoogleWorkspaceTargetConfig = z.output<typeof GoogleWorkspaceTargetConfigSchema>;
