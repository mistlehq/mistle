import { z } from "zod";

const RepoRelativeSkillPathPattern =
  /^(?:\.|(?=.*\S)(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/).+)$/;

const repoRelativeSkillPathSchema = z.string().regex(RepoRelativeSkillPathPattern, {
  message: "Skill relativePath must be a repo-relative path.",
});

export const sandboxProfileVersionSkillSelectionSchema = z
  .object({
    name: z.string().min(1),
    relativePath: repoRelativeSkillPathSchema,
  })
  .strict();

export const sandboxProfileVersionSkillsConfigSchema = z
  .object({
    originUrl: z.url(),
    selectedSkills: z.array(sandboxProfileVersionSkillSelectionSchema),
  })
  .strict();

export type SandboxProfileVersionSkillsConfig = z.infer<
  typeof sandboxProfileVersionSkillsConfigSchema
>;

export function mapProfileVersionSkillsConfig(
  input: unknown,
): SandboxProfileVersionSkillsConfig | null {
  if (input === null) {
    return null;
  }

  return sandboxProfileVersionSkillsConfigSchema.parse(input);
}
