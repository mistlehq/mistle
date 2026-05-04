import { createTokenizerProxyRuntime } from "@mistle/tokenizer-proxy/runtime";
import type { TokenizerProxyConfig } from "@mistle/tokenizer-proxy/types";

import type {
  TestInfraRequirement,
  TestService,
  TestServiceDefinition,
  TestServiceStartInput,
} from "../../environment/index.js";
import { TestEnvironmentIdHeader } from "../../environment/test-isolation.js";
import { peers } from "./peers.js";
import { ServiceIds } from "./service-ids.js";
import { assertMode, httpEndpoint, httpHealth } from "./shared.js";

const Host = "127.0.0.1";

export function service(infra: readonly TestInfraRequirement[]): TestServiceDefinition {
  return {
    id: ServiceIds.TOKENIZER_PROXY,
    infra,
    serviceReferences: [ServiceIds.CONTROL_PLANE_API],
    endpoints: {
      http: {
        host: Host,
      },
    },
    supportedModes: ["runtime"],
    healthCheck: async (runtime) => httpHealth(runtime, ServiceIds.TOKENIZER_PROXY),
    start,
  };
}

async function start(startInput: TestServiceStartInput): Promise<TestService> {
  assertMode(startInput.mode, "runtime", ServiceIds.TOKENIZER_PROXY);

  const endpoint = httpEndpoint(startInput, ServiceIds.TOKENIZER_PROXY);
  const peer = peers(startInput.services, startInput.plannedEndpoints);
  const runtime = createTokenizerProxyRuntime({
    app: config({
      port: endpoint.port,
      controlPlaneBaseUrl: peer.url(ServiceIds.CONTROL_PLANE_API),
    }),
  });

  try {
    await runtime.start();
  } catch (error) {
    await runtime.stop();
    throw error;
  }

  return {
    id: ServiceIds.TOKENIZER_PROXY,
    mode: startInput.mode,
    endpoints: {
      http: {
        hostBaseUrl: endpoint.hostBaseUrl,
        internalBaseUrl: endpoint.hostBaseUrl,
      },
    },
    stop: runtime.stop,
  };
}

function config(input: { port: number; controlPlaneBaseUrl: string }): TokenizerProxyConfig {
  return {
    server: {
      host: Host,
      port: input.port,
    },
    controlPlaneApi: {
      baseUrl: input.controlPlaneBaseUrl,
      publicBaseUrl: input.controlPlaneBaseUrl,
    },
    internalAuth: {
      serviceToken: "integration-new-internal-service-token",
    },
    egressGrant: {
      tokenSecret: "integration-new-egress-token-secret",
      tokenIssuer: "integration-new-data-plane-worker",
      tokenAudience: "integration-new-tokenizer-proxy",
    },
    __dangerouslyEnableTestIsolation: {
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    },
  };
}
