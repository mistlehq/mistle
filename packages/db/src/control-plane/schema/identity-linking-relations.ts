import { relations } from "drizzle-orm";

import { integrationConnections } from "./integration-connections.js";
import { integrationTargets } from "./integration-targets.js";
import { organizationCredentialKeys } from "./organization-credential-keys.js";
import { organizationIdentityLinkProviderConfigs } from "./organization-identity-link-provider-configs.js";
import { organizations } from "./organizations.js";
import { userExternalPrincipalCredentialSecrets } from "./user-external-principal-credential-secrets.js";
import { userExternalPrincipalCredentials } from "./user-external-principal-credentials.js";
import { userExternalPrincipalKeys } from "./user-external-principal-keys.js";
import { userExternalPrincipals } from "./user-external-principals.js";
import { users } from "./users.js";

export const organizationsRelations = relations(organizations, ({ many }) => ({
  identityLinkProviderConfigs: many(organizationIdentityLinkProviderConfigs),
  externalPrincipals: many(userExternalPrincipals),
  externalPrincipalKeys: many(userExternalPrincipalKeys),
  externalPrincipalCredentials: many(userExternalPrincipalCredentials),
  externalPrincipalCredentialSecrets: many(userExternalPrincipalCredentialSecrets),
}));

export const usersRelations = relations(users, ({ many }) => ({
  createdIdentityLinkProviderConfigs: many(organizationIdentityLinkProviderConfigs, {
    relationName: "identity_link_provider_config_created_by_user",
  }),
  updatedIdentityLinkProviderConfigs: many(organizationIdentityLinkProviderConfigs, {
    relationName: "identity_link_provider_config_updated_by_user",
  }),
  externalPrincipals: many(userExternalPrincipals),
}));

export const organizationCredentialKeysRelations = relations(
  organizationCredentialKeys,
  ({ many }) => ({
    externalPrincipalCredentialSecrets: many(userExternalPrincipalCredentialSecrets),
  }),
);

export const organizationIdentityLinkProviderConfigsRelations = relations(
  organizationIdentityLinkProviderConfigs,
  ({ many, one }) => ({
    organization: one(organizations, {
      fields: [organizationIdentityLinkProviderConfigs.organizationId],
      references: [organizations.id],
    }),
    integrationTarget: one(integrationTargets, {
      fields: [organizationIdentityLinkProviderConfigs.integrationTargetKey],
      references: [integrationTargets.targetKey],
    }),
    integrationConnection: one(integrationConnections, {
      fields: [organizationIdentityLinkProviderConfigs.integrationConnectionId],
      references: [integrationConnections.id],
    }),
    createdByUser: one(users, {
      relationName: "identity_link_provider_config_created_by_user",
      fields: [organizationIdentityLinkProviderConfigs.createdByUserId],
      references: [users.id],
    }),
    updatedByUser: one(users, {
      relationName: "identity_link_provider_config_updated_by_user",
      fields: [organizationIdentityLinkProviderConfigs.updatedByUserId],
      references: [users.id],
    }),
    principals: many(userExternalPrincipals),
  }),
);

export const userExternalPrincipalsRelations = relations(
  userExternalPrincipals,
  ({ many, one }) => ({
    organization: one(organizations, {
      fields: [userExternalPrincipals.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [userExternalPrincipals.userId],
      references: [users.id],
    }),
    organizationProviderConfig: one(organizationIdentityLinkProviderConfigs, {
      fields: [userExternalPrincipals.organizationProviderConfigId],
      references: [organizationIdentityLinkProviderConfigs.id],
    }),
    integrationConnection: one(integrationConnections, {
      fields: [userExternalPrincipals.integrationConnectionId],
      references: [integrationConnections.id],
    }),
    keys: many(userExternalPrincipalKeys),
    credentials: many(userExternalPrincipalCredentials),
  }),
);

export const userExternalPrincipalKeysRelations = relations(
  userExternalPrincipalKeys,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [userExternalPrincipalKeys.organizationId],
      references: [organizations.id],
    }),
    principal: one(userExternalPrincipals, {
      fields: [userExternalPrincipalKeys.principalId],
      references: [userExternalPrincipals.id],
    }),
  }),
);

export const userExternalPrincipalCredentialsRelations = relations(
  userExternalPrincipalCredentials,
  ({ many, one }) => ({
    organization: one(organizations, {
      fields: [userExternalPrincipalCredentials.organizationId],
      references: [organizations.id],
    }),
    principal: one(userExternalPrincipals, {
      fields: [userExternalPrincipalCredentials.principalId],
      references: [userExternalPrincipals.id],
    }),
    secrets: many(userExternalPrincipalCredentialSecrets),
  }),
);

export const userExternalPrincipalCredentialSecretsRelations = relations(
  userExternalPrincipalCredentialSecrets,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [userExternalPrincipalCredentialSecrets.organizationId],
      references: [organizations.id],
    }),
    credential: one(userExternalPrincipalCredentials, {
      fields: [userExternalPrincipalCredentialSecrets.credentialId],
      references: [userExternalPrincipalCredentials.id],
    }),
    organizationCredentialKey: one(organizationCredentialKeys, {
      fields: [
        userExternalPrincipalCredentialSecrets.organizationId,
        userExternalPrincipalCredentialSecrets.organizationCredentialKeyVersion,
      ],
      references: [organizationCredentialKeys.organizationId, organizationCredentialKeys.version],
    }),
  }),
);
