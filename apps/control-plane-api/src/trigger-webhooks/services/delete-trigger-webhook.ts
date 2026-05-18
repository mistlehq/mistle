import {
  TriggerKinds,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, eq } from "drizzle-orm";

export type DeleteWebhookTriggerInput = {
  organizationId: string;
  triggerId: string;
};

export async function deleteTriggerWebhook(
  ctx: { db: ControlPlaneDatabase },
  input: DeleteWebhookTriggerInput,
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const deletedRows = await ctx.db
    .delete(tables.triggers)
    .where(
      and(
        eq(tables.triggers.id, input.triggerId),
        eq(tables.triggers.organizationId, input.organizationId),
        eq(tables.triggers.kind, TriggerKinds.WEBHOOK),
      ),
    )
    .returning({
      id: tables.triggers.id,
    });

  if (deletedRows[0] === undefined) {
    throw new NotFoundError("NOT_FOUND", "Webhook trigger was not found.");
  }
}
