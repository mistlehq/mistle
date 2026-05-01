import { fileURLToPath } from "node:url";

import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";

import type {
  TestInfraRequirement,
  TestService,
  TestServiceDefinition,
  TestServiceStartInput,
} from "../../environment/index.js";
import { peers } from "./peers.js";
import { ServiceIds } from "./service-ids.js";
import {
  assertMode,
  infraRequirement,
  infraValue,
  processHealth,
  processService,
  resolvedInfra,
} from "./shared.js";

const AppDir = fileURLToPath(new URL("../../../../../apps/control-plane-worker", import.meta.url));

const InfraIds = {
  POSTGRES: "postgres",
  MAILPIT: "mailpit",
};

const PostgresValues = {
  HOST_POOLED_URL: "host.pooledUrl",
  CONTROL_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.controlPlaneNamespaceId",
};

const MailpitValues = {
  SMTP_HOST: "smtp.host",
  SMTP_PORT: "smtp.port",
};

export function service(infra: readonly TestInfraRequirement[]): TestServiceDefinition {
  return {
    id: ServiceIds.CONTROL_PLANE_WORKER,
    infra,
    serviceReferences: [ServiceIds.CONTROL_PLANE_API, ServiceIds.DATA_PLANE_API],
    supportedModes: ["process"],
    healthCheck: async (runtime) => processHealth(runtime, ServiceIds.CONTROL_PLANE_WORKER),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.CONTROL_PLANE_WORKER),
      mailpitInfra: infraRequirement(infra, InfraIds.MAILPIT, ServiceIds.CONTROL_PLANE_WORKER),
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
  mailpitInfra: TestInfraRequirement;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    assertMode(startInput.mode, "process", ServiceIds.CONTROL_PLANE_WORKER);

    const postgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const mailpit = resolvedInfra(startInput.infra, input.mailpitInfra.id);
    const peer = peers(startInput.services, startInput.plannedEndpoints);

    return processService({
      id: ServiceIds.CONTROL_PLANE_WORKER,
      mode: startInput.mode,
      cwd: AppDir,
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        "./node_modules/@openworkflow/cli/dist/cli.js",
        "worker",
        "start",
        "--config",
        "./openworkflow.config.ts",
      ],
      env: {
        MISTLE_ENV: "development",
        NODE_ENV: "development",
        MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: infraValue(
          postgres,
          PostgresValues.HOST_POOLED_URL,
        ),
        MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: infraValue(
          postgres,
          PostgresValues.CONTROL_PLANE_WORKFLOW_NAMESPACE_ID,
        ),
        MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "2",
        MISTLE_EMAIL_SMTP_FROM_ADDRESS: "integration-new@mistle.test",
        MISTLE_EMAIL_SMTP_FROM_NAME: "Mistle Integration",
        MISTLE_EMAIL_SMTP_HOST: infraValue(mailpit, MailpitValues.SMTP_HOST),
        MISTLE_EMAIL_SMTP_PORT: infraValue(mailpit, MailpitValues.SMTP_PORT),
        MISTLE_EMAIL_SMTP_SECURE: "false",
        MISTLE_EMAIL_SMTP_USERNAME: "integration-new",
        MISTLE_EMAIL_SMTP_PASSWORD: "integration-new",
        MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: peer.url(ServiceIds.DATA_PLANE_API),
        MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: peer.url(ServiceIds.CONTROL_PLANE_API),
        MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "integration-new-internal-service-token",
        MISTLE_SANDBOX_PROVIDER: "docker",
        MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: getLocalDevDockerRegistrySandboxBaseImageRef(),
        MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: peer.ws(
          ServiceIds.DATA_PLANE_GATEWAY,
          "/tunnel/sandbox",
        ),
        MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL: peer.ws(
          ServiceIds.DATA_PLANE_GATEWAY,
          "/tunnel/sandbox",
        ),
        MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "integration-new-connection-secret",
        MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "integration-new-control-plane-api",
        MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "integration-new-data-plane-gateway",
        MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "integration-new-bootstrap-token-secret",
        MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "integration-new-data-plane-worker",
        MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "integration-new-data-plane-gateway",
        MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "integration-new-egress-token-secret",
        MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "integration-new-data-plane-worker",
        MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "integration-new-tokenizer-proxy",
        MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
        MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-new-port-access-secret",
        MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "integration-new-control-plane-api",
        MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "integration-new-data-plane-gateway",
        MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET:
          "integration-new-port-access-cookie-secret",
        MISTLE_TELEMETRY_ENABLED: "false",
        MISTLE_TELEMETRY_DEBUG: "false",
      },
    });
  };
}
