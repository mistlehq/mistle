import { mintEgressGrant } from "./egress-grant.js";
import type { EgressGrantConfig } from "./types.js";

const DefaultRuntimePlanEgressGrantTtlSeconds = 60 * 60 * 24;

type RuntimePlanEgressCredentialResolver =
  | {
      kind: "integration_connection";
      connectionId: string;
      secretType: string;
      slotKey?: string;
      resolverKey?: string;
    }
  | {
      kind: "linked_principal";
      providerFamily: string;
      actingUserRequired: boolean;
      resolutionMode: "required" | "preferred";
      credentialKind?: string;
    };

type RuntimePlanEgressRoute = {
  egressRuleId: string;
  bindingId: string;
  familyId: string;
  variantId: string;
  credentialResolver: RuntimePlanEgressCredentialResolver;
  upstream: {
    baseUrl: string;
  };
  authInjection:
    | {
        type: "aws_sigv4";
        service: string;
        region: string;
      }
    | {
        type: "bearer" | "basic" | "header" | "query";
        target: string;
        username?: string;
      };
  additionalHeaders?: Record<string, string>;
  additionalCredentialHeaders?: ReadonlyArray<{
    header: string;
    credentialResolver: RuntimePlanEgressCredentialResolver;
  }>;
  match: {
    methods?: ReadonlyArray<string>;
    pathPrefixes?: ReadonlyArray<string>;
  };
  requestMiddleware?: ReadonlyArray<string>;
};

function toGrantCredentialResolver(input: {
  resolver: RuntimePlanEgressCredentialResolver;
  actingUserId?: string;
}):
  | {
      kind: "integration_connection";
      connectionId: string;
      secretType: string;
      slotKey?: string;
      resolverKey?: string;
    }
  | {
      kind: "linked_principal";
      providerFamily: string;
      actingUserRequired: boolean;
      resolutionMode: "required" | "preferred";
      actingUserId?: string;
      credentialKind?: string;
    } {
  if (input.resolver.kind === "integration_connection") {
    return {
      kind: "integration_connection",
      connectionId: input.resolver.connectionId,
      secretType: input.resolver.secretType,
      ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
      ...(input.resolver.resolverKey === undefined
        ? {}
        : { resolverKey: input.resolver.resolverKey }),
    };
  }

  return {
    kind: "linked_principal",
    providerFamily: input.resolver.providerFamily,
    actingUserRequired: input.resolver.actingUserRequired,
    resolutionMode: input.resolver.resolutionMode,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.resolver.credentialKind === undefined
      ? {}
      : { credentialKind: input.resolver.credentialKind }),
  };
}

export async function createRuntimePlanEgressGrantByRuleId(input: {
  config: EgressGrantConfig;
  organizationId: string;
  sandboxInstanceId: string;
  runtimePlan: {
    egressRoutes: ReadonlyArray<RuntimePlanEgressRoute>;
  };
  actingUserId?: string;
  ttlSeconds?: number;
}): Promise<Record<string, string>> {
  const ttlSeconds = input.ttlSeconds ?? DefaultRuntimePlanEgressGrantTtlSeconds;
  const entries = await Promise.all(
    input.runtimePlan.egressRoutes.map(async (route) => [
      route.egressRuleId,
      await mintEgressGrant({
        config: input.config,
        claims: {
          sub: input.sandboxInstanceId,
          jti: route.egressRuleId,
          bindingId: route.bindingId,
          organizationId: input.organizationId,
          familyId: route.familyId,
          variantId: route.variantId,
          credentialResolverKind: route.credentialResolver.kind,
          ...toGrantCredentialResolver({
            resolver: route.credentialResolver,
            ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
          }),
          ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
          upstreamBaseUrl: route.upstream.baseUrl,
          authInjectionType: route.authInjection.type,
          ...(route.additionalHeaders === undefined
            ? {}
            : { additionalHeaders: route.additionalHeaders }),
          ...(route.additionalCredentialHeaders === undefined
            ? {}
            : {
                additionalCredentialHeaders: route.additionalCredentialHeaders.map((header) => ({
                  header: header.header,
                  credentialResolver: toGrantCredentialResolver({
                    resolver: header.credentialResolver,
                    ...(input.actingUserId === undefined
                      ? {}
                      : { actingUserId: input.actingUserId }),
                  }),
                })),
              }),
          ...(route.authInjection.type === "aws_sigv4"
            ? {
                authInjectionService: route.authInjection.service,
                authInjectionRegion: route.authInjection.region,
              }
            : {
                authInjectionTarget: route.authInjection.target,
                ...(route.authInjection.type !== "basic" ||
                route.authInjection.username === undefined
                  ? {}
                  : { authInjectionUsername: route.authInjection.username }),
              }),
          ...(route.match.methods === undefined ? {} : { allowedMethods: route.match.methods }),
          ...(route.match.pathPrefixes === undefined
            ? {}
            : { allowedPathPrefixes: route.match.pathPrefixes }),
          ...(route.requestMiddleware === undefined
            ? {}
            : { requestMiddleware: route.requestMiddleware }),
        },
        ttlSeconds,
      }),
    ]),
  );

  return Object.fromEntries(entries);
}
