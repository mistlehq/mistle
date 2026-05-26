import { randomInt } from "node:crypto";

import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
import {
  ControlPlaneConstraintIds,
  getControlPlaneDatabaseSchema,
  isControlPlaneUniqueViolation,
  PortAccessLinkCreatedByKinds,
} from "@mistle/db/control-plane";
import { derivePortAccessHost, mintPortAccessBootstrapToken } from "@mistle/port-access-auth";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../errors.js";
import type {
  MintSandboxInstancePortAccessInput,
  ResolveSandboxInstancePortAccessLinkInput,
  SandboxInstancePortAccess,
  SandboxInstancePortAccessRedirect,
} from "./types.js";

const PortAccessLinkSlugAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PortAccessLinkSlugLength = 12;
const MaxPortAccessLinkSlugCreateAttempts = 5;
const ReusablePortAccessLinkMinimumRemainingTtlSeconds = 30;

type ExistingSandboxInstance = NonNullable<GetSandboxInstanceResponse>;

export function buildPortAccessBootstrapUrl(input: {
  gatewayWsUrl: string;
  host: string;
  bootstrapPath: string;
  token: string;
}): string {
  const gatewayUrl = new URL(input.gatewayWsUrl);
  const protocol =
    gatewayUrl.protocol === "wss:"
      ? "https:"
      : gatewayUrl.protocol === "ws:"
        ? "http:"
        : (() => {
            throw new Error(
              `Unsupported sandbox gateway websocket protocol '${gatewayUrl.protocol}'.`,
            );
          })();
  const bootstrapUrl = new URL(`${protocol}//${input.host}${input.bootstrapPath}`);
  if (gatewayUrl.port.length > 0) {
    bootstrapUrl.port = gatewayUrl.port;
  }
  bootstrapUrl.searchParams.set("token", input.token);
  return bootstrapUrl.toString();
}

async function getExistingSandboxInstance(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<ExistingSandboxInstance> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw new SandboxInstancesNotFoundError(
      SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  return sandboxInstance;
}

function createInstanceFailedError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id" | "failureMessage">,
): SandboxInstancesConflictError {
  const failureMessage =
    sandboxInstance.failureMessage === null
      ? `Sandbox instance '${sandboxInstance.id}' failed and cannot be connected.`
      : `Sandbox instance '${sandboxInstance.id}' failed and cannot be connected: ${sandboxInstance.failureMessage}`;

  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_FAILED,
    failureMessage,
  );
}

function createInstanceNotConnectableError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id" | "status">,
): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    `Sandbox instance '${sandboxInstance.id}' is '${sandboxInstance.status}' and is not connectable.`,
  );
}

export async function mintPortAccess(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: MintSandboxInstancePortAccessInput,
): Promise<SandboxInstancePortAccess> {
  const sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, {
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  const host = derivePortAccessHost({
    config: {
      baseDomain: input.baseDomain,
    },
    sandboxInstanceId: sandboxInstance.id,
    port: input.port,
  });
  const reusableLink = await findReusablePortAccessLink(input, {
    sandboxInstanceId: sandboxInstance.id,
  });
  if (reusableLink !== null) {
    return buildSandboxInstancePortAccess({
      host,
      publicBaseUrl: input.publicBaseUrl,
      linkPathBase: input.linkPathBase,
      slug: reusableLink.slug,
      expiresAt: reusableLink.expiresAt,
    });
  }

  const expiresAt = new Date(input.clock.nowMs() + input.linkTtlSeconds * 1000).toISOString();
  const slug = await createUniquePortAccessLinkSlug(input, {
    sandboxInstanceId: sandboxInstance.id,
    expiresAt,
  });

  return buildSandboxInstancePortAccess({
    host,
    publicBaseUrl: input.publicBaseUrl,
    linkPathBase: input.linkPathBase,
    slug,
    expiresAt,
  });
}

export async function resolvePortAccessLink(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: ResolveSandboxInstancePortAccessLinkInput,
): Promise<SandboxInstancePortAccessRedirect | null> {
  const link = await input.db.query.portAccessLinks.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.slug, input.slug), eq(table.organizationId, input.organizationId)),
  });

  if (link === undefined) {
    return null;
  }

  const expiresAtMs = Date.parse(link.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error(`Port Access link '${link.id}' has an invalid expires_at timestamp.`);
  }

  const secondsRemaining = Math.floor((expiresAtMs - input.clock.nowMs()) / 1000);
  if (secondsRemaining < 1) {
    return null;
  }

  const sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, {
    organizationId: input.organizationId,
    instanceId: link.sandboxInstanceId,
  });

  if (sandboxInstance.status === "failed") {
    throw createInstanceFailedError(sandboxInstance);
  }

  if (!sandboxInstance.connectable) {
    throw createInstanceNotConnectableError(sandboxInstance);
  }

  const host = derivePortAccessHost({
    config: {
      baseDomain: input.baseDomain,
    },
    sandboxInstanceId: link.sandboxInstanceId,
    port: link.port,
  });
  const token = await mintPortAccessBootstrapToken({
    config: input.tokenConfig,
    sandboxInstanceId: link.sandboxInstanceId,
    port: link.port,
    host,
    ttlSeconds: Math.min(secondsRemaining, input.tokenTtlSeconds),
  });

  return {
    bootstrapUrl: buildPortAccessBootstrapUrl({
      gatewayWsUrl: input.gatewayWsUrl,
      host,
      bootstrapPath: input.bootstrapPath,
      token,
    }),
  };
}

async function createUniquePortAccessLinkSlug(
  input: MintSandboxInstancePortAccessInput,
  link: {
    sandboxInstanceId: string;
    expiresAt: string;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  for (let attempt = 1; attempt <= MaxPortAccessLinkSlugCreateAttempts; attempt += 1) {
    const slug = createPortAccessLinkSlug();
    try {
      await input.db.insert(tables.portAccessLinks).values({
        slug,
        organizationId: input.organizationId,
        sandboxInstanceId: link.sandboxInstanceId,
        port: input.port,
        createdByKind:
          input.createdBy.kind === "agent"
            ? PortAccessLinkCreatedByKinds.AGENT
            : PortAccessLinkCreatedByKinds.USER,
        createdById: input.createdBy.id,
        expiresAt: link.expiresAt,
      });
      return slug;
    } catch (error) {
      if (
        isControlPlaneUniqueViolation(error, ControlPlaneConstraintIds.PORT_ACCESS_LINK_SLUG) &&
        attempt < MaxPortAccessLinkSlugCreateAttempts
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to create a unique Port Access link slug.");
}

async function findReusablePortAccessLink(
  input: MintSandboxInstancePortAccessInput,
  link: {
    sandboxInstanceId: string;
  },
): Promise<{ slug: string; expiresAt: string } | null> {
  const minimumExpiresAt = new Date(
    input.clock.nowMs() + ReusablePortAccessLinkMinimumRemainingTtlSeconds * 1000,
  ).toISOString();
  const reusableLink = await input.db.query.portAccessLinks.findFirst({
    where: (table, { and, eq, gt }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.sandboxInstanceId, link.sandboxInstanceId),
        eq(table.port, input.port),
        gt(table.expiresAt, minimumExpiresAt),
      ),
    orderBy: (table, { desc }) => [desc(table.expiresAt)],
  });

  if (reusableLink === undefined) {
    return null;
  }

  return {
    slug: reusableLink.slug,
    expiresAt: normalizePortAccessLinkExpiresAt({
      id: reusableLink.id,
      expiresAt: reusableLink.expiresAt,
    }),
  };
}

function normalizePortAccessLinkExpiresAt(input: { id: string; expiresAt: string }): string {
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error(`Port Access link '${input.id}' has an invalid expires_at timestamp.`);
  }

  return new Date(expiresAtMs).toISOString();
}

function buildSandboxInstancePortAccess(input: {
  host: string;
  publicBaseUrl: string;
  linkPathBase: "/p/ports";
  slug: string;
  expiresAt: string;
}): SandboxInstancePortAccess {
  return {
    host: input.host,
    url: buildPublicPortAccessLinkUrl({
      publicBaseUrl: input.publicBaseUrl,
      linkPathBase: input.linkPathBase,
      slug: input.slug,
    }),
    expiresAt: input.expiresAt,
  };
}

function createPortAccessLinkSlug(): string {
  let slug = "";
  for (let index = 0; index < PortAccessLinkSlugLength; index += 1) {
    slug += PortAccessLinkSlugAlphabet[randomInt(PortAccessLinkSlugAlphabet.length)];
  }
  return slug;
}

function buildPublicPortAccessLinkUrl(input: {
  publicBaseUrl: string;
  linkPathBase: string;
  slug: string;
}): string {
  const baseUrl = new URL(input.publicBaseUrl);
  const pathBase = input.linkPathBase.endsWith("/")
    ? input.linkPathBase.slice(0, -1)
    : input.linkPathBase;
  baseUrl.pathname = `${pathBase}/${input.slug}`;
  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString();
}
