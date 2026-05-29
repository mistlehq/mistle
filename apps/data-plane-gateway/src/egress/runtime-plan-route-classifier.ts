import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";

type RuntimePlanEgressRoute = CompiledRuntimePlan["egressRoutes"][number];

export type GatewayEgressRouteClassification =
  | {
      kind: "unmatched";
    }
  | {
      kind: "matched";
      route: RuntimePlanEgressRoute;
    }
  | {
      kind: "ambiguous";
      routes: RuntimePlanEgressRoute[];
    };

export function classifyRuntimePlanEgressRoute(input: {
  authority: string;
  method: string;
  path: string;
  runtimePlan: CompiledRuntimePlan;
}): GatewayEgressRouteClassification {
  const host = normalizeAuthorityHost(input.authority);
  const method = input.method.toUpperCase();
  const matchingRoutes = input.runtimePlan.egressRoutes.filter((route) =>
    doesRouteMatchRequest({
      host,
      method,
      path: input.path,
      route,
    }),
  );

  if (matchingRoutes.length === 0) {
    return { kind: "unmatched" };
  }
  if (matchingRoutes.length === 1) {
    const route = matchingRoutes[0];
    if (route === undefined) {
      throw new Error("Expected one matching egress route.");
    }
    return {
      kind: "matched",
      route,
    };
  }

  return {
    kind: "ambiguous",
    routes: matchingRoutes,
  };
}

function doesRouteMatchRequest(input: {
  host: string;
  method: string;
  path: string;
  route: RuntimePlanEgressRoute;
}): boolean {
  return (
    input.route.match.hosts.some((host) => host.toLowerCase() === input.host) &&
    (input.route.match.pathPrefixes ?? ["/"]).some((pathPrefix) =>
      pathBelongsToPrefix({ path: input.path, pathPrefix }),
    ) &&
    (input.route.match.methods ?? [input.method]).some(
      (routeMethod) => routeMethod.toUpperCase() === input.method,
    )
  );
}

function pathBelongsToPrefix(input: { path: string; pathPrefix: string }): boolean {
  const normalizedPath = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const normalizedPathPrefix = normalizePathPrefix(input.pathPrefix);

  return (
    normalizedPathPrefix === "/" ||
    normalizedPath === normalizedPathPrefix ||
    normalizedPath.startsWith(`${normalizedPathPrefix}/`)
  );
}

function normalizePathPrefix(pathPrefix: string): string {
  const normalizedPathPrefix = pathPrefix.trim();
  if (normalizedPathPrefix === "/") {
    return "/";
  }
  if (normalizedPathPrefix.endsWith("/")) {
    return normalizedPathPrefix.slice(0, -1);
  }
  return normalizedPathPrefix;
}

function normalizeAuthorityHost(authority: string): string {
  const trimmedAuthority = authority.trim().toLowerCase();
  if (trimmedAuthority.startsWith("[")) {
    const closeBracketIndex = trimmedAuthority.indexOf("]");
    if (closeBracketIndex === -1) {
      return trimmedAuthority;
    }

    return trimmedAuthority.slice(1, closeBracketIndex);
  }

  return trimmedAuthority.split(":", 1)[0] ?? trimmedAuthority;
}
