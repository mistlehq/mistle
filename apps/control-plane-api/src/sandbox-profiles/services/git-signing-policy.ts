import { z } from "zod";

export const GitCommitSigningModeSchema = z.enum(["disabled", "allowed", "required"]);
export const GitCommitSigningFormatSchema = z.enum(["ssh", "openpgp"]);

export const GitIdentityLinkProviderPolicySchema = z
  .object({
    gitCommitSigningMode: GitCommitSigningModeSchema.optional(),
    gitCommitSigningFormat: GitCommitSigningFormatSchema.optional(),
  })
  .loose();

export type GitCommitSigningMode = z.infer<typeof GitCommitSigningModeSchema>;
export type GitCommitSigningFormat = z.infer<typeof GitCommitSigningFormatSchema>;

export function resolveGitCommitSigningPolicy(input: {
  policy: unknown;
  gitCommitSigningIntegrationConnectionId?: string | null;
}): {
  mode: GitCommitSigningMode;
  format: GitCommitSigningFormat;
  integrationConnectionId: string | null;
} {
  if (input.policy === null) {
    return {
      mode: "allowed",
      format: "ssh",
      integrationConnectionId: input.gitCommitSigningIntegrationConnectionId ?? null,
    };
  }

  const parsedPolicy = GitIdentityLinkProviderPolicySchema.parse(input.policy);
  return {
    mode: parsedPolicy.gitCommitSigningMode ?? "allowed",
    format: parsedPolicy.gitCommitSigningFormat ?? "ssh",
    integrationConnectionId: input.gitCommitSigningIntegrationConnectionId ?? null,
  };
}
