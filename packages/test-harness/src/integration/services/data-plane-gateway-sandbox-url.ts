import { createDockerSandboxReachableHostUrl } from "../../system/docker-sandbox-networking.js";
import type { IntegrationSandboxOptions } from "./options.js";
import type { PeerResolver } from "./peers.js";
import { ServiceIds } from "./service-ids.js";

export function createGatewayWsUrl(input: {
  environmentId: string;
  sandbox: IntegrationSandboxOptions | undefined;
  peer: Pick<PeerResolver, "ws">;
}): string {
  const publicGatewayBaseUrl = input.sandbox?.publicServiceBaseUrls?.get(
    ServiceIds.DATA_PLANE_GATEWAY,
  );
  if (publicGatewayBaseUrl === undefined) {
    const harnessGatewayWsUrl = input.peer.ws(ServiceIds.DATA_PLANE_GATEWAY, "/tunnel/sandbox");
    if (input.sandbox?.provider === "docker") {
      return createDockerSandboxReachableHostUrl(harnessGatewayWsUrl);
    }

    return harnessGatewayWsUrl;
  }

  const url = new URL("/tunnel/sandbox", publicGatewayBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("x-mistle-test-environment-id", input.environmentId);
  return url.toString();
}
