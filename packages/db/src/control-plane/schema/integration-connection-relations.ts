import { relations } from "drizzle-orm";

import { integrationConnectionResourceStates } from "./integration-connection-resource-states.js";
import { integrationConnectionResources } from "./integration-connection-resources.js";
import { integrationConnections } from "./integration-connections.js";
import { integrationTargets } from "./integration-targets.js";
import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { integrationWebhookSources } from "./integration-webhook-sources.js";
import { userExternalPrincipals } from "./user-external-principals.js";
import { users } from "./users.js";

export function defineIntegrationConnectionRelations(input: {
  integrationConnectionResourceStates: typeof integrationConnectionResourceStates;
  integrationConnectionResources: typeof integrationConnectionResources;
  integrationConnections: typeof integrationConnections;
  integrationTargets: typeof integrationTargets;
  integrationWebhookEvents: typeof integrationWebhookEvents;
  integrationWebhookSources: typeof integrationWebhookSources;
  userExternalPrincipals: typeof userExternalPrincipals;
  users: typeof users;
}) {
  const integrationConnectionsRelations = relations(
    input.integrationConnections,
    ({ many, one }) => ({
      target: one(input.integrationTargets, {
        fields: [input.integrationConnections.targetKey],
        references: [input.integrationTargets.targetKey],
      }),
      resources: many(input.integrationConnectionResources),
      resourceStates: many(input.integrationConnectionResourceStates),
      webhookEvents: many(input.integrationWebhookEvents),
      webhookSources: many(input.integrationWebhookSources),
    }),
  );

  const integrationConnectionResourcesRelations = relations(
    input.integrationConnectionResources,
    ({ one }) => ({
      connection: one(input.integrationConnections, {
        fields: [input.integrationConnectionResources.connectionId],
        references: [input.integrationConnections.id],
      }),
    }),
  );

  const integrationConnectionResourceStatesRelations = relations(
    input.integrationConnectionResourceStates,
    ({ one }) => ({
      connection: one(input.integrationConnections, {
        fields: [input.integrationConnectionResourceStates.connectionId],
        references: [input.integrationConnections.id],
      }),
    }),
  );

  const integrationTargetsRelations = relations(input.integrationTargets, ({ many }) => ({
    connections: many(input.integrationConnections),
    webhookEvents: many(input.integrationWebhookEvents),
    webhookSources: many(input.integrationWebhookSources),
  }));

  const integrationWebhookEventsRelations = relations(
    input.integrationWebhookEvents,
    ({ one }) => ({
      connection: one(input.integrationConnections, {
        fields: [input.integrationWebhookEvents.integrationConnectionId],
        references: [input.integrationConnections.id],
      }),
      resolvedPrincipal: one(input.userExternalPrincipals, {
        fields: [input.integrationWebhookEvents.resolvedPrincipalId],
        references: [input.userExternalPrincipals.id],
      }),
      resolvedUser: one(input.users, {
        fields: [input.integrationWebhookEvents.resolvedUserId],
        references: [input.users.id],
      }),
      source: one(input.integrationWebhookSources, {
        fields: [input.integrationWebhookEvents.integrationWebhookSourceId],
        references: [input.integrationWebhookSources.id],
      }),
      target: one(input.integrationTargets, {
        fields: [input.integrationWebhookEvents.targetKey],
        references: [input.integrationTargets.targetKey],
      }),
    }),
  );

  const integrationWebhookSourcesRelations = relations(
    input.integrationWebhookSources,
    ({ many, one }) => ({
      connection: one(input.integrationConnections, {
        fields: [input.integrationWebhookSources.integrationConnectionId],
        references: [input.integrationConnections.id],
      }),
      events: many(input.integrationWebhookEvents),
      target: one(input.integrationTargets, {
        fields: [input.integrationWebhookSources.targetKey],
        references: [input.integrationTargets.targetKey],
      }),
    }),
  );

  return {
    integrationConnectionResourcesRelations,
    integrationConnectionResourceStatesRelations,
    integrationConnectionsRelations,
    integrationTargetsRelations,
    integrationWebhookEventsRelations,
    integrationWebhookSourcesRelations,
  };
}

const defaultRelations = defineIntegrationConnectionRelations({
  integrationConnectionResourceStates,
  integrationConnectionResources,
  integrationConnections,
  integrationTargets,
  integrationWebhookEvents,
  integrationWebhookSources,
  userExternalPrincipals,
  users,
});

export const integrationConnectionsRelations = defaultRelations.integrationConnectionsRelations;
export const integrationConnectionResourcesRelations =
  defaultRelations.integrationConnectionResourcesRelations;
export const integrationConnectionResourceStatesRelations =
  defaultRelations.integrationConnectionResourceStatesRelations;
export const integrationTargetsRelations = defaultRelations.integrationTargetsRelations;
export const integrationWebhookEventsRelations = defaultRelations.integrationWebhookEventsRelations;
export const integrationWebhookSourcesRelations =
  defaultRelations.integrationWebhookSourcesRelations;
