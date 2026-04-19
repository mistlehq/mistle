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

const OrganizationIdentityLinkProviderSchema = z
  .object({
    providerFamily: z.string().min(1),
    displayName: z.string().min(1),
    logoKey: z.string().min(1),
    eligibleTargetKeys: z.array(z.string().min(1)),
    eligibleConnectionMethodIds: z.array(z.string().min(1)),
    eligibleConnections: z.array(OrganizationIdentityLinkProviderConnectionSummarySchema),
    configurationStatus: z.enum(["unconfigured", "active", "disabled"]),
    selectedConnection: OrganizationIdentityLinkProviderConnectionSummarySchema.nullable(),
    configuredAt: z.string().min(1).nullable(),
    updatedAt: z.string().min(1).nullable(),
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

export type OrganizationIdentityLinkProvider = z.infer<
  typeof OrganizationIdentityLinkProviderSchema
>;
export type OrganizationIdentityLinkProviderLink = z.infer<
  typeof OrganizationIdentityLinkProviderLinkSchema
>;

export function organizationIdentityLinkProvidersQueryKey(
  activeOrganizationId: string,
): readonly ["settings", "organization-identity-linking", string] {
  return ["settings", "organization-identity-linking", activeOrganizationId];
}

export function organizationIdentityLinkProviderLinksQueryKey(input: {
  activeOrganizationId: string;
  providerFamily: string;
}): readonly ["settings", "organization-identity-linking-links", string, string] {
  return [
    "settings",
    "organization-identity-linking-links",
    input.activeOrganizationId,
    input.providerFamily,
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

export async function configureOrganizationIdentityLinkProvider(input: {
  providerFamily: string;
  integrationConnectionId: string;
}): Promise<OrganizationIdentityLinkProvider> {
  try {
    const response = await requestControlPlane({
      operation: "configureOrganizationIdentityLinkProvider",
      method: "PUT",
      pathname: `/v1/organization/identity-linking/providers/${encodeURIComponent(input.providerFamily)}`,
      body: {
        integrationConnectionId: input.integrationConnectionId,
      },
      fallbackMessage: "Could not save identity-linking provider configuration.",
    });

    return readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkProviderSchema,
      operation: "configureOrganizationIdentityLinkProvider",
    });
  } catch (error) {
    throw wrapOrganizationIdentityLinkingApiError({
      operation: "configureOrganizationIdentityLinkProvider",
      error,
      fallbackMessage: "Could not save identity-linking provider configuration.",
    });
  }
}

export async function listOrganizationIdentityLinkProviderLinks(input: {
  providerFamily: string;
  signal?: AbortSignal;
}): Promise<readonly OrganizationIdentityLinkProviderLink[]> {
  try {
    const response = await requestControlPlane({
      operation: "listOrganizationIdentityLinkProviderLinks",
      method: "GET",
      pathname: `/v1/organization/identity-linking/providers/${encodeURIComponent(input.providerFamily)}/links`,
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

export async function putOrganizationIdentityLinkProviderStatus(input: {
  providerFamily: string;
  status: "active" | "disabled";
}): Promise<OrganizationIdentityLinkProvider> {
  try {
    const response = await requestControlPlane({
      operation: "putOrganizationIdentityLinkProviderStatus",
      method: "PUT",
      pathname: `/v1/organization/identity-linking/providers/${encodeURIComponent(input.providerFamily)}/status`,
      body: {
        status: input.status,
      },
      fallbackMessage: "Could not update identity-linking provider status.",
    });

    return readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkProviderSchema,
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

export async function disableOrganizationIdentityLinkProvider(input: {
  providerFamily: string;
}): Promise<OrganizationIdentityLinkProvider> {
  try {
    const response = await requestControlPlane({
      operation: "disableOrganizationIdentityLinkProvider",
      method: "DELETE",
      pathname: `/v1/organization/identity-linking/providers/${encodeURIComponent(input.providerFamily)}`,
      fallbackMessage: "Could not disable identity-linking provider configuration.",
    });

    return readJsonWithSchema({
      response,
      schema: OrganizationIdentityLinkProviderSchema,
      operation: "disableOrganizationIdentityLinkProvider",
    });
  } catch (error) {
    throw wrapOrganizationIdentityLinkingApiError({
      operation: "disableOrganizationIdentityLinkProvider",
      error,
      fallbackMessage: "Could not disable identity-linking provider configuration.",
    });
  }
}
