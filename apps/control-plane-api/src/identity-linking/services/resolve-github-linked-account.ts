import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import { GitHubProviderFamily } from "../github-signing.js";
import { type LinkedAccount, listLinkedAccounts } from "./list-linked-accounts.js";

export async function resolveExactOneGitHubLinkedAccountOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<LinkedAccount> {
  const githubLinkedAccounts = (
    await listLinkedAccounts(ctx, {
      organizationId: input.organizationId,
      userId: input.userId,
    })
  ).filter((linkedAccount) => linkedAccount.providerFamily === GitHubProviderFamily);

  if (githubLinkedAccounts.length === 0) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND,
      "GitHub linked account was not found for the authenticated user.",
    );
  }

  if (githubLinkedAccounts.length > 1) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS,
      "Multiple GitHub linked-account configs are available. Use a config-specific GitHub endpoint.",
    );
  }

  return githubLinkedAccounts[0]!;
}
