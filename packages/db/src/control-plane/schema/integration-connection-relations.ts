import { relations } from "drizzle-orm";

import { integrationConnectionResourceStates } from "./integration-connection-resource-states.js";
import { integrationConnections } from "./integration-connections.js";
import { integrationTargets } from "./integration-targets.js";

export const integrationConnectionsRelations = relations(
  integrationConnections,
  ({ many, one }) => ({
    target: one(integrationTargets, {
      fields: [integrationConnections.targetKey],
      references: [integrationTargets.targetKey],
    }),
    resourceStates: many(integrationConnectionResourceStates),
  }),
);

export const integrationConnectionResourceStatesRelations = relations(
  integrationConnectionResourceStates,
  ({ one }) => ({
    connection: one(integrationConnections, {
      fields: [integrationConnectionResourceStates.connectionId],
      references: [integrationConnections.id],
    }),
  }),
);

export const integrationTargetsRelations = relations(integrationTargets, ({ many }) => ({
  connections: many(integrationConnections),
}));
