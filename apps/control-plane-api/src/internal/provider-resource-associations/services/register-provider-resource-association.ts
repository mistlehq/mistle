import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type {
  AssociatedProviderResourceKind,
  AssociatedResourceEventRouting,
} from "@mistle/integrations-core";
import { sql } from "drizzle-orm";

import { getSandboxInstance } from "../../sandbox-runtime/services/get-sandbox-instance.js";
import { ProviderResourceAssociationsNotFoundCodes } from "../constants.js";

export type RegisterProviderResourceAssociationInput = {
  integrationConnectionId: string;
  resourceKind: AssociatedProviderResourceKind;
  providerResourceId: string;
  sandboxInstanceId: string;
};

export type RegisterProviderResourceAssociationResult =
  | {
      status: "created";
      associationId: string;
    }
  | {
      status: "already_exists";
      associationId: string;
    }
  | {
      status: "not_applicable";
      reason: "provider_actor_not_configured" | "resource_kind_not_enabled";
    };

export async function registerProviderResourceAssociation(
  ctx: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
  },
  input: RegisterProviderResourceAssociationInput,
): Promise<RegisterProviderResourceAssociationResult> {
  const connection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      config: true,
      id: true,
      organizationId: true,
    },
    where: (table, { eq }) => eq(table.id, input.integrationConnectionId),
  });

  if (connection === undefined) {
    throw new NotFoundError(
      ProviderResourceAssociationsNotFoundCodes.INTEGRATION_CONNECTION_NOT_FOUND,
      "Integration connection was not found.",
    );
  }

  const sandboxInstance = await getSandboxInstance(
    {
      dataPlaneClient: ctx.dataPlaneClient,
    },
    {
      organizationId: connection.organizationId,
      instanceId: input.sandboxInstanceId,
    },
  );

  if (
    !supportsResourceKind({
      resourceKind: input.resourceKind,
      routing: sandboxInstance.associatedResourceEventRouting,
    })
  ) {
    return {
      status: "not_applicable",
      reason: "resource_kind_not_enabled",
    };
  }

  return await createAssociation(ctx.db, input);
}

function supportsResourceKind(input: {
  resourceKind: AssociatedProviderResourceKind;
  routing: AssociatedResourceEventRouting | null;
}): boolean {
  if (input.routing === null || !input.routing.enabled) {
    return false;
  }

  return input.routing.resources.some(
    (resource) => resource.resourceKind === input.resourceKind && resource.eventTypes.length > 0,
  );
}

async function createAssociation(
  db: ControlPlaneDatabase,
  input: RegisterProviderResourceAssociationInput,
): Promise<RegisterProviderResourceAssociationResult> {
  const tables = getControlPlaneDatabaseSchema(db);
  const insertedRows = await db
    .insert(tables.providerResourceAssociations)
    .values({
      integrationConnectionId: input.integrationConnectionId,
      resourceKind: input.resourceKind,
      providerResourceId: input.providerResourceId,
      sandboxInstanceId: input.sandboxInstanceId,
      updatedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [
        tables.providerResourceAssociations.integrationConnectionId,
        tables.providerResourceAssociations.resourceKind,
        tables.providerResourceAssociations.providerResourceId,
      ],
    })
    .returning({
      id: tables.providerResourceAssociations.id,
    });

  const insertedRow = insertedRows[0];
  if (insertedRow !== undefined) {
    return {
      status: "created",
      associationId: insertedRow.id,
    };
  }

  const existingAssociation = await db.query.providerResourceAssociations.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.integrationConnectionId, input.integrationConnectionId),
        eq(table.resourceKind, input.resourceKind),
        eq(table.providerResourceId, input.providerResourceId),
      ),
  });
  if (existingAssociation === undefined) {
    throw new Error("Expected existing provider resource association after conflict.");
  }

  return {
    status: "already_exists",
    associationId: existingAssociation.id,
  };
}
