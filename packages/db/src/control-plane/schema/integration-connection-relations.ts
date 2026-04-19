import { relations } from "drizzle-orm";

import { integrationConnectionResourceStates } from "./integration-connection-resource-states.js";
import { integrationConnectionResources } from "./integration-connection-resources.js";
import { integrationConnections } from "./integration-connections.js";
import { integrationTargets } from "./integration-targets.js";
import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { integrationWebhookSources } from "./integration-webhook-sources.js";
import { userExternalPrincipals } from "./user-external-principals.js";
import { users } from "./users.js";

export const integrationConnectionsRelations = relations(
  integrationConnections,
  ({ many, one }) => ({
    target: one(integrationTargets, {
      fields: [integrationConnections.targetKey],
      references: [integrationTargets.targetKey],
    }),
    resources: many(integrationConnectionResources),
    resourceStates: many(integrationConnectionResourceStates),
    webhookEvents: many(integrationWebhookEvents),
    webhookSources: many(integrationWebhookSources),
  }),
);

export const integrationConnectionResourcesRelations = relations(
  integrationConnectionResources,
  ({ one }) => ({
    connection: one(integrationConnections, {
      fields: [integrationConnectionResources.connectionId],
      references: [integrationConnections.id],
    }),
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
  webhookEvents: many(integrationWebhookEvents),
  webhookSources: many(integrationWebhookSources),
}));

export const integrationWebhookEventsRelations = relations(integrationWebhookEvents, ({ one }) => ({
  connection: one(integrationConnections, {
    fields: [integrationWebhookEvents.integrationConnectionId],
    references: [integrationConnections.id],
  }),
  resolvedPrincipal: one(userExternalPrincipals, {
    fields: [integrationWebhookEvents.resolvedPrincipalId],
    references: [userExternalPrincipals.id],
  }),
  resolvedUser: one(users, {
    fields: [integrationWebhookEvents.resolvedUserId],
    references: [users.id],
  }),
  source: one(integrationWebhookSources, {
    fields: [integrationWebhookEvents.integrationWebhookSourceId],
    references: [integrationWebhookSources.id],
  }),
  target: one(integrationTargets, {
    fields: [integrationWebhookEvents.targetKey],
    references: [integrationTargets.targetKey],
  }),
}));

export const integrationWebhookSourcesRelations = relations(
  integrationWebhookSources,
  ({ many, one }) => ({
    connection: one(integrationConnections, {
      fields: [integrationWebhookSources.integrationConnectionId],
      references: [integrationConnections.id],
    }),
    events: many(integrationWebhookEvents),
    target: one(integrationTargets, {
      fields: [integrationWebhookSources.targetKey],
      references: [integrationTargets.targetKey],
    }),
  }),
);
