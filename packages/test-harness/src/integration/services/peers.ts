import type { TestServiceEndpoints, TestServiceHandle } from "../../environment/index.js";
import type { ServiceId } from "./service-ids.js";
import { httpService } from "./shared.js";

export type PeerResolver = {
  url: (serviceId: ServiceId) => string;
  ws: (serviceId: ServiceId, path: string) => string;
};

export function peers(
  services: ReadonlyMap<string, TestServiceHandle>,
  plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints>,
): PeerResolver {
  return {
    url: (serviceId) => {
      const service = services.get(serviceId);
      if (service !== undefined) {
        return httpService(service).hostBaseUrl;
      }

      const endpoint = plannedEndpoints.get(serviceId)?.http;
      if (endpoint === undefined) {
        return missingPeer.http(serviceId);
      }

      return endpoint.hostBaseUrl;
    },
    ws: (serviceId, path) => {
      const service = services.get(serviceId);
      if (service !== undefined) {
        return toWebSocketUrl(httpService(service).hostBaseUrl, path);
      }

      const endpoint = plannedEndpoints.get(serviceId)?.http;
      if (endpoint === undefined) {
        return missingPeer.ws(serviceId, path);
      }

      return toWebSocketUrl(endpoint.hostBaseUrl, path);
    },
  };
}

const missingPeer = {
  http: (serviceId: ServiceId): string => `http://127.0.0.1:9/__missing-peer/${serviceId}`,
  ws: (serviceId: ServiceId, path: string): string =>
    `ws://127.0.0.1:9/__missing-peer/${serviceId}${normalizePath(path)}`,
};

function toWebSocketUrl(baseUrl: string, path: string): string {
  const url = new URL(normalizePath(path), baseUrl);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new Error(`Cannot derive WebSocket URL from peer URL '${baseUrl}'.`);
  }

  return url.toString();
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
