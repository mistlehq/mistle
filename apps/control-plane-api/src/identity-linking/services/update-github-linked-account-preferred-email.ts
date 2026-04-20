import {
  UserExternalPrincipalStatuses,
  userExternalPrincipals,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import { listLinkedAccounts } from "./list-linked-accounts.js";

const GitHubProviderFamily = "github";

const GitHubAvailableEmailSchema = z
  .object({
    email: z.email(),
    primary: z.boolean(),
    verified: z.boolean(),
  })
  .strict();

const GitHubPrincipalProfileSchema = z
  .object({
    login: z.string().min(1),
    displayName: z.string().min(1).optional(),
    avatarUrl: z.url().optional(),
    preferredEmail: z.email().optional(),
    availableEmails: z.array(GitHubAvailableEmailSchema).optional(),
  })
  .loose();

export async function updateGitHubLinkedAccountPreferredEmail(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    userId: string;
    preferredEmail: string;
  },
): Promise<void> {
  const githubLinkedAccount = (
    await listLinkedAccounts(ctx, {
      organizationId: input.organizationId,
      userId: input.userId,
    })
  ).find((linkedAccount) => linkedAccount.providerFamily === GitHubProviderFamily);

  if (githubLinkedAccount?.principal === null || githubLinkedAccount?.principal === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND,
      "GitHub linked account was not found for the authenticated user.",
    );
  }

  if (githubLinkedAccount.principal.status !== UserExternalPrincipalStatuses.ACTIVE) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_PREFERRED_EMAIL_INPUT,
      "GitHub linked account must be active before its preferred email can be updated.",
    );
  }

  const parsedProfile = GitHubPrincipalProfileSchema.safeParse(
    githubLinkedAccount.principal.profile,
  );
  if (!parsedProfile.success) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_PREFERRED_EMAIL_INPUT,
      "GitHub linked account does not expose a valid preferred-email profile.",
    );
  }

  const availableEmails = parsedProfile.data.availableEmails;
  if (availableEmails === undefined || availableEmails.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_PREFERRED_EMAIL_INPUT,
      "GitHub linked account does not have selectable emails.",
    );
  }

  const selectedEmail = availableEmails.find((email) => email.email === input.preferredEmail);
  if (selectedEmail === undefined) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_PREFERRED_EMAIL_INPUT,
      `GitHub preferred email '${input.preferredEmail}' is not available for this linked account.`,
    );
  }

  if (!selectedEmail.verified) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_PREFERRED_EMAIL_INPUT,
      `GitHub preferred email '${input.preferredEmail}' is not verified.`,
    );
  }

  const [updatedPrincipal] = await ctx.db
    .update(userExternalPrincipals)
    .set({
      profile: {
        ...parsedProfile.data,
        preferredEmail: selectedEmail.email,
      },
      updatedAt: sql`now()`,
    })
    .where(eq(userExternalPrincipals.id, githubLinkedAccount.principal.id))
    .returning({
      id: userExternalPrincipals.id,
    });

  if (updatedPrincipal === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND,
      "GitHub linked account was not found for the authenticated user.",
    );
  }
}
