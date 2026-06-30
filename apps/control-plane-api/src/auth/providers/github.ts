import type { BetterAuthOptions } from "better-auth";

import type { GitHubProviderConfig } from "./types.js";

export function createGitHubSocialProvider(
  config: GitHubProviderConfig & { allowSignups: boolean },
): NonNullable<BetterAuthOptions["socialProviders"]> {
  return {
    github: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      disableImplicitSignUp: !config.allowSignups,
    },
  };
}
