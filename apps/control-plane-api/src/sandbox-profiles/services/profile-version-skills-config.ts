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
  .strict()
  .transform((value) => ({
    ...value,
    originUrl: canonicalizePublicGitHubSkillsSourceOriginUrl(value.originUrl) ?? value.originUrl,
  }));

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

export function canonicalizePublicGitHubSkillsSourceOriginUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return null;
  }

  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  if (pathParts.length !== 2) {
    return null;
  }

  const [owner, rawRepository] = pathParts;
  if (owner === undefined || rawRepository === undefined) {
    return null;
  }

  const repository = rawRepository.endsWith(".git")
    ? rawRepository.slice(0, -".git".length)
    : rawRepository;
  if (
    repository.length === 0 ||
    !isValidGitHubPathPart(owner) ||
    !isValidGitHubPathPart(repository)
  ) {
    return null;
  }

  return `https://github.com/${owner}/${repository}.git`;
}

function isValidGitHubPathPart(input: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(input) && !input.startsWith(".") && !input.endsWith(".");
}
