import { z } from "zod";

import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { requestControlPlane } from "../../api/request-control-plane.js";

export const LinkedAccountPrincipalSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["active", "reauthorization_required"]),
    providerSubjectId: z.string().min(1).nullable(),
    profile: z.record(z.string(), z.unknown()).nullable(),
    linkedAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const LinkedAccountCredentialSchema = z
  .object({
    id: z.string().min(1),
    credentialKind: z.string().min(1),
    status: z.enum(["active", "expired", "reauthorization_required"]),
    accessTokenExpiresAt: z.string().min(1).nullable(),
    refreshTokenExpiresAt: z.string().min(1).nullable(),
    lastValidatedAt: z.string().min(1).nullable(),
    updatedAt: z.string().min(1),
  })
  .strict();

export const LinkedAccountCommitSigningSchema = z
  .object({
    credentialId: z.string().min(1),
    publicKeyFingerprint: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const LinkedAccountSchema = z
  .object({
    providerFamily: z.string().min(1),
    displayName: z.string().min(1),
    logoKey: z.string().min(1),
    configurationStatus: z.enum(["active", "disabled"]),
    principal: LinkedAccountPrincipalSchema.nullable(),
    credential: LinkedAccountCredentialSchema.nullable(),
    commitSigning: LinkedAccountCommitSigningSchema.nullable(),
  })
  .strict();

const LinkedAccountsResponseSchema = z
  .object({
    linkedAccounts: z.array(LinkedAccountSchema),
  })
  .strict();

const StartLinkedAccountAuthorizationResponseSchema = z
  .object({
    authorizationUrl: z.url(),
    expiresAt: z.string().min(1),
  })
  .strict();

const UpdateGitHubLinkedAccountPreferredEmailBodySchema = z
  .object({
    preferredEmail: z.email(),
  })
  .strict();

export type LinkedAccount = z.infer<typeof LinkedAccountSchema>;
export type StartLinkedAccountAuthorizationResult = z.infer<
  typeof StartLinkedAccountAuthorizationResponseSchema
>;

export function linkedAccountsQueryKey(
  activeOrganizationId: string,
): readonly ["settings", "linked-accounts", string] {
  return ["settings", "linked-accounts", activeOrganizationId];
}

export class LinkedAccountsApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;
  readonly code: string | null;

  constructor(input: {
    operation: string;
    status: number;
    body: unknown;
    message: string;
    code?: string | null;
  }) {
    super(input.message);
    this.operation = input.operation;
    this.status = input.status;
    this.body = input.body;
    this.code = input.code ?? null;
  }
}

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);
  if (!parsed.success) {
    throw new LinkedAccountsApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: "Linked accounts API response payload is invalid.",
    });
  }

  return parsed.data;
}

function wrapLinkedAccountsApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): LinkedAccountsApiError {
  return new LinkedAccountsApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}

export async function listLinkedAccounts(input: {
  signal?: AbortSignal;
}): Promise<readonly LinkedAccount[]> {
  try {
    const response = await requestControlPlane({
      operation: "listLinkedAccounts",
      method: "GET",
      pathname: "/v1/me/linked-accounts",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load linked accounts.",
    });

    const data = await readJsonWithSchema({
      response,
      schema: LinkedAccountsResponseSchema,
      operation: "listLinkedAccounts",
    });

    return data.linkedAccounts;
  } catch (error) {
    throw wrapLinkedAccountsApiError({
      operation: "listLinkedAccounts",
      error,
      fallbackMessage: "Could not load linked accounts.",
    });
  }
}

export async function startLinkedAccountAuthorization(input: {
  providerFamily: string;
}): Promise<StartLinkedAccountAuthorizationResult> {
  try {
    const response = await requestControlPlane({
      operation: "startLinkedAccountAuthorization",
      method: "POST",
      pathname: `/v1/me/linked-accounts/${encodeURIComponent(input.providerFamily)}`,
      fallbackMessage: "Could not start linked-account authorization.",
    });

    return await readJsonWithSchema({
      response,
      schema: StartLinkedAccountAuthorizationResponseSchema,
      operation: "startLinkedAccountAuthorization",
    });
  } catch (error) {
    throw wrapLinkedAccountsApiError({
      operation: "startLinkedAccountAuthorization",
      error,
      fallbackMessage: "Could not start linked-account authorization.",
    });
  }
}

export async function unlinkLinkedAccount(input: { providerFamily: string }): Promise<void> {
  try {
    const response = await requestControlPlane({
      operation: "unlinkLinkedAccount",
      method: "DELETE",
      pathname: `/v1/me/linked-accounts/${encodeURIComponent(input.providerFamily)}`,
      fallbackMessage: "Could not unlink linked account.",
    });

    await response.text();
  } catch (error) {
    throw wrapLinkedAccountsApiError({
      operation: "unlinkLinkedAccount",
      error,
      fallbackMessage: "Could not unlink linked account.",
    });
  }
}

export async function updateGitHubLinkedAccountPreferredEmail(input: {
  preferredEmail: string;
}): Promise<void> {
  const body = UpdateGitHubLinkedAccountPreferredEmailBodySchema.parse(input);

  try {
    const response = await requestControlPlane({
      operation: "updateGitHubLinkedAccountPreferredEmail",
      method: "PUT",
      pathname: "/v1/me/linked-accounts/github/preferred-email",
      body,
      fallbackMessage: "Could not update GitHub preferred email.",
    });

    await response.text();
  } catch (error) {
    throw wrapLinkedAccountsApiError({
      operation: "updateGitHubLinkedAccountPreferredEmail",
      error,
      fallbackMessage: "Could not update GitHub preferred email.",
    });
  }
}

export async function uploadGitHubLinkedAccountSigningKey(input: { file: File }): Promise<void> {
  const body = new FormData();
  body.set("file", input.file);

  try {
    const response = await requestControlPlane({
      operation: "uploadGitHubLinkedAccountSigningKey",
      method: "PUT",
      pathname: "/v1/me/linked-accounts/github/signing-key",
      body,
      fallbackMessage: "Could not upload GitHub signing key.",
    });

    await response.text();
  } catch (error) {
    throw wrapLinkedAccountsApiError({
      operation: "uploadGitHubLinkedAccountSigningKey",
      error,
      fallbackMessage: "Could not upload GitHub signing key.",
    });
  }
}

export async function deleteGitHubLinkedAccountSigningKey(): Promise<void> {
  try {
    const response = await requestControlPlane({
      operation: "deleteGitHubLinkedAccountSigningKey",
      method: "DELETE",
      pathname: "/v1/me/linked-accounts/github/signing-key",
      fallbackMessage: "Could not remove GitHub signing key.",
    });

    await response.text();
  } catch (error) {
    throw wrapLinkedAccountsApiError({
      operation: "deleteGitHubLinkedAccountSigningKey",
      error,
      fallbackMessage: "Could not remove GitHub signing key.",
    });
  }
}
