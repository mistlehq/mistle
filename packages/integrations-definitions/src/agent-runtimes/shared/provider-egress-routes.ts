import type { EgressCredentialRoute } from "@mistle/integrations-core";

export type IntegrationConnectionCredentialRoute = EgressCredentialRoute & {
  credentialResolver: Extract<
    EgressCredentialRoute["credentialResolver"],
    { kind: "integration_connection" }
  >;
};

export function isIntegrationConnectionCredentialRoute(
  route: EgressCredentialRoute,
): route is IntegrationConnectionCredentialRoute {
  return route.credentialResolver.kind === "integration_connection";
}

export function routeHasHost(input: { route: EgressCredentialRoute; host: string }): boolean {
  return input.route.match.hosts.some((host) => host.toLowerCase() === input.host);
}

export function routeHasPathPrefix(input: {
  route: EgressCredentialRoute;
  pathPrefix: string;
}): boolean {
  const baseUrlPathname = new URL(input.route.upstream.baseUrl).pathname;
  return (
    baseUrlPathname.startsWith(input.pathPrefix) ||
    input.route.match.pathPrefixes?.some((pathPrefix) =>
      pathPrefix.startsWith(input.pathPrefix),
    ) === true
  );
}

export function isOpenAiApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "openai" &&
    routeHasHost({ route, host: "api.openai.com" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isOpenAiChatGptSubscriptionRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "openai" &&
    routeHasHost({ route, host: "chatgpt.com" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    (route.credentialResolver.secretType === "oauth2_access_token" ||
      route.credentialResolver.secretType === "chatgpt_access_token")
  );
}

export function isAnthropicApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "anthropic" &&
    routeHasHost({ route, host: "api.anthropic.com" }) &&
    route.authInjection.type === "header" &&
    route.authInjection.target.toLowerCase() === "x-api-key" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isOpenCodeGoRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "opencode" &&
    routeHasHost({ route, host: "opencode.ai" }) &&
    routeHasPathPrefix({ route, pathPrefix: "/zen/go" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}
