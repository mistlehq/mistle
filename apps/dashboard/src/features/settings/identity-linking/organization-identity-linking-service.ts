import { z } from "zod";

import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { requestControlPlane } from "../../api/request-control-plane.js";

const OrganizationIdentityLinkProviderConnectionSummarySchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    displayName: z.string().min(1),
    status: z.enum(["active", "error", "revoked"]),
    connectionMethodId: z.string().min(1).optional(),
    connectionMethodLabel: z.string().min(1).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const OrganizationIdentityLinkProviderConfigSchema = z
  .object({
    organizationProviderConfigId: z.string().min(1),
    integrationConnectionId: z.string().min(1),
    configurationStatus: z.enum(["active", "disabled"]),
    selectedConnection: OrganizationIdentityLinkProviderConnectionSummarySchema,
    configuredAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const OrganizationIdentityLinkProviderSchema = z
  .object({
    providerFamily: z.string().min(1),
    organizationProviderConfigId: z.string().min(1).nullable(),
    integrationConnectionId: z.string().min(1).nullable(),
    displayName: z.string().min(1),
    logoKey: z.string().min(1),
    eligibleTargetKeys: z.array(z.string().min(1)),
    eligibleConnectionMethodIds: z.array(z.string().min(1)),
    eligibleConnections: z.array(OrganizationIdentityLinkProviderConnectionSummarySchema),
    configurationStatus: z.enum(["unconfigured", "active", "disabled"]),
    selectedConnection: OrganizationIdentityLinkProviderConnectionSummarySchema.nullable(),
    configuredAt: z.string().min(1).nullable(),
    updatedAt: z.string().min(1).nullable(),
    configs: z.array(OrganizationIdentityLinkProviderConfigSchema),
  })
  .strict();

const OrganizationIdentityLinkProvidersResponseSchema = z
  .object({
    providers: z.array(OrganizationIdentityLinkProviderSchema),
  })
  .strict();

const OrganizationIdentityLinkProviderPrincipalSummarySchema = z
  .object({
    providerSubjectId: z.string().min(1).nullable(),
    login: z.string().min(1).nullable(),
    displayName: z.string().min(1).nullable(),
    email: z.email().nullable(),
  })
  .strict();

const OrganizationIdentityLinkProviderLinkSchema = z
  .object({
    userId: z.string().min(1),
    name: z.string().min(1),
    email: z.email(),
    linked: z.boolean(),
    principalSummary: OrganizationIdentityLinkProviderPrincipalSummarySchema.nullable(),
    updatedAt: z.string().min(1).nullable(),
  })
  .strict();

const OrganizationIdentityLinkProviderLinksResponseSchema = z
  .object({
    links: z.array(OrganizationIdentityLinkProviderLinkSchema),
  })
  .strict();

const OrganizationIdentityLinkGitCommitSigningImpactSchema = z
  .object({
    action: z.enum(["enable", "disable"]),
    updatedProfileCount: z.number().int().min(0),
    invariantViolationCount: z.number().int().min(0),
  })
  .strict();

export type OrganizationIdentityLinkProvider = z.infer<
  typeof OrganizationIdentityLinkProviderSchema
>;
export type OrganizationIdentityLinkProviderConfig = z.infer<
  typeof OrganizationIdentityLinkProviderConfigSchema
>;
export type OrganizationIdentityLinkProviderLink = z.infer<
  typeof OrganizationIdentityLinkProviderLinkSchema
>;
export type OrganizationIdentityLinkGitCommitSigningImpact = z.infer<
  typeof OrganizationIdentityLinkGitCommitSigningImpactSchema
>;

export function organizationIdentityLinkProvidersQueryKey(
  activeOrganizationId: string,
): readonly ["settings", "organization-identity-linking", string] {
  return ["settings", "organization-identity-linking", activeOrganizationId];
}

export function organizationIdentityLinkProviderLinksQueryKey(input: {
  activeOrganizationId: string;
  organizationProviderConfigId: string;
}): readonly ["settings", "organization-identity-linking-links", string, string] {
  return [
    "settings",
    "organization-identity-linking-links",
    input.activeOrganizationId,
    input.organizationProviderConfigId,
  ];
}

export function organizationIdentityLinkGitCommitSigningImpactQueryKey(input: {
  activeOrganizationId: string;
  providerFamily: string;
  integrationConnectionId: string;
  action: "enable" | "disable";
}): readonly [
  "settings",
  "organization-identity-linking-git-commit-signing-impact",
  string,
  string,
  string,
  "enable" | "disable",
] {
  return [
    "settings",
    "organization-identity-linking-git-commit-signing-impact",
    input.activeOrganizationId,
    input.providerFamily,
    input.integrationConnectionId,
    input.action,
  ];
}

export class OrganizationIdentityLinkingApiError extends Error {
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
    throw new OrganizationIdentityLinkingApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: "Identity Linking API response payload is invalid.",
    });
  }

  return parsed.data;
}

function wrapOrganizationIdentityLinkingApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): OrganizationIdentityLinkingApiError {
  return new OrganizationIdentityLinkingApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}

export async function listOrganizationIdentityLinkProviders(input: {
  signal?: AbortSignal;
}): Promise<readonly OrganizationIdentityLinkProvider[]> {
  try {
    const response = await requestControlPlane({
      operation: "listOrganizationIdentityLinkProviders",
      method: "GET",
      pathname: "/v1/organization/identity-linking/providers",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load identity-linking providers.",
    });

    const data = await readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkProvidersResponseSchema,
      operation: "listOrganizationIdentityLinkProviders",
    });

    return data.providers;
  } catch (error) {
    throw wrapOrganizationIdentityLinkingApiError({
      operation: "listOrganizationIdentityLinkProviders",
      error,
      fallbackMessage: "Could not load identity-linking providers.",
    });
  }
}

export async function createOrganizationIdentityLinkProviderConfig(input: {
  providerFamily: string;
  integrationConnectionId: string;
  status: "active" | "disabled";
}): Promise<OrganizationIdentityLinkProviderConfig> {
  try {
    const response = await requestControlPlane({
      operation: "createOrganizationIdentityLinkProviderConfig",
      method: "POST",
      pathname: `/v1/organization/identity-linking/providers/${encodeURIComponent(input.providerFamily)}/configs`,
      body: {
        integrationConnectionId: input.integrationConnectionId,
        status: input.status,
      },
      fallbackMessage: "Could not save identity-linking provider configuration.",
    });

    return readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkProviderConfigSchema,
      operation: "createOrganizationIdentityLinkProviderConfig",
    });
  } catch (error) {
    throw wrapOrganizationIdentityLinkingApiError({
      operation: "createOrganizationIdentityLinkProviderConfig",
      error,
      fallbackMessage: "Could not save identity-linking provider configuration.",
    });
  }
}

export async function listOrganizationIdentityLinkProviderLinks(input: {
  organizationProviderConfigId: string;
  signal?: AbortSignal;
}): Promise<readonly OrganizationIdentityLinkProviderLink[]> {
  try {
    const response = await requestControlPlane({
      operation: "listOrganizationIdentityLinkProviderLinks",
      method: "GET",
      pathname: `/v1/organization/identity-linking/provider-configs/${encodeURIComponent(input.organizationProviderConfigId)}/links`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load linked-provider visibility.",
    });

    const data = await readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkProviderLinksResponseSchema,
      operation: "listOrganizationIdentityLinkProviderLinks",
    });

    return data.links;
  } catch (error) {
    throw wrapOrganizationIdentityLinkingApiError({
      operation: "listOrganizationIdentityLinkProviderLinks",
      error,
      fallbackMessage: "Could not load linked-provider visibility.",
    });
  }
}

export async function getOrganizationIdentityLinkGitCommitSigningImpact(input: {
  providerFamily: string;
  integrationConnectionId: string;
  action: "enable" | "disable";
  signal?: AbortSignal;
}): Promise<OrganizationIdentityLinkGitCommitSigningImpact> {
  try {
    const response = await requestControlPlane({
      operation: "getOrganizationIdentityLinkGitCommitSigningImpact",
      method: "GET",
      pathname: `/v1/organization/identity-linking/providers/${encodeURIComponent(input.providerFamily)}/git-commit-signing-impact`,
      query: {
        integrationConnectionId: input.integrationConnectionId,
        action: input.action,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load commit-signing impact.",
    });

    return readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkGitCommitSigningImpactSchema,
      operation: "getOrganizationIdentityLinkGitCommitSigningImpact",
    });
  } catch (error) {
    throw wrapOrganizationIdentityLinkingApiError({
      operation: "getOrganizationIdentityLinkGitCommitSigningImpact",
      error,
      fallbackMessage: "Could not load commit-signing impact.",
    });
  }
}

export async function putOrganizationIdentityLinkProviderStatus(input: {
  organizationProviderConfigId: string;
  status: "active" | "disabled";
}): Promise<OrganizationIdentityLinkProviderConfig> {
  try {
    const response = await requestControlPlane({
      operation: "putOrganizationIdentityLinkProviderStatus",
      method: "PUT",
      pathname: `/v1/organization/identity-linking/provider-configs/${encodeURIComponent(input.organizationProviderConfigId)}/status`,
      body: {
        status: input.status,
      },
      fallbackMessage: "Could not update identity-linking provider status.",
    });

    return readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkProviderConfigSchema,
      operation: "putOrganizationIdentityLinkProviderStatus",
    });
  } catch (error) {
    throw wrapOrganizationIdentityLinkingApiError({
      operation: "putOrganizationIdentityLinkProviderStatus",
      error,
      fallbackMessage: "Could not update identity-linking provider status.",
    });
  }
}
