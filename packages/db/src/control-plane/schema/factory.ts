import { pgSchema } from "drizzle-orm/pg-core";

import { defineAccounts } from "./accounts.js";
import { defineApiKeyPermissions } from "./api-key-permissions.js";
import { defineApiKeys } from "./api-keys.js";
import { defineIdentityLinkRedirectSessions } from "./identity-link-redirect-sessions.js";
import { defineIntegrationConnectionCredentials } from "./integration-connection-credentials.js";
import { defineIntegrationConnectionDeviceAuthorizationAttempts } from "./integration-connection-device-authorization-attempts.js";
import { defineIntegrationConnectionRedirectSessions } from "./integration-connection-redirect-sessions.js";
import { defineIntegrationConnectionRelations } from "./integration-connection-relations.js";
import { defineIntegrationConnectionResourceStates } from "./integration-connection-resource-states.js";
import { defineIntegrationConnectionResources } from "./integration-connection-resources.js";
import { defineIntegrationConnections } from "./integration-connections.js";
import { defineIntegrationCredentials } from "./integration-credentials.js";
import { defineIntegrationTargets } from "./integration-targets.js";
import { defineIntegrationWebhookEvents } from "./integration-webhook-events.js";
import { defineIntegrationWebhookSources } from "./integration-webhook-sources.js";
import { defineInvitations } from "./invitations.js";
import { defineMembers } from "./members.js";
import { defineOrganizationBillingCustomers } from "./organization-billing-customers.js";
import { defineOrganizationCredentialKeys } from "./organization-credential-keys.js";
import { defineOrganizationIdentityLinkProviderConfigs } from "./organization-identity-link-provider-configs.js";
import { defineOrganizationSandboxStorageSettings } from "./organization-sandbox-storage-settings.js";
import { defineOrganizations } from "./organizations.js";
import { defineSandboxProfileSnapshotRefreshScheduleTargets } from "./sandbox-profile-snapshot-refresh-schedule-targets.js";
import { defineSandboxProfileVersionIntegrationBindings } from "./sandbox-profile-version-integration-bindings.js";
import { defineSandboxProfileVersionSnapshotJobs } from "./sandbox-profile-version-snapshot-jobs.js";
import { defineSandboxProfileVersions } from "./sandbox-profile-versions.js";
import { defineSandboxProfiles } from "./sandbox-profiles.js";
import { defineScheduleTriggers } from "./schedule-triggers.js";
import { defineScheduledActions } from "./scheduled-actions.js";
import { defineSchedules } from "./schedules.js";
import { defineSessions } from "./sessions.js";
import { defineTeamMembers } from "./team-members.js";
import { defineTeams } from "./teams.js";
import { defineTriggerConversationDeliveryProcessors } from "./trigger-conversation-delivery-processors.js";
import { defineTriggerConversationDeliveryTasks } from "./trigger-conversation-delivery-tasks.js";
import { defineTriggerConversationRoutes } from "./trigger-conversation-routes.js";
import { defineTriggerConversations } from "./trigger-conversations.js";
import { defineTriggerRuns } from "./trigger-runs.js";
import { defineTriggerTargets } from "./trigger-targets.js";
import { defineTriggers } from "./triggers.js";
import { defineUserExternalPrincipalCredentialSecrets } from "./user-external-principal-credential-secrets.js";
import { defineUserExternalPrincipalCredentials } from "./user-external-principal-credentials.js";
import { defineUserExternalPrincipalKeys } from "./user-external-principal-keys.js";
import { defineUserExternalPrincipals } from "./user-external-principals.js";
import { defineUsers } from "./users.js";
import { defineVerifications } from "./verifications.js";
import { defineWebhookTriggers } from "./webhook-triggers.js";

/**
 * Creates control-plane table objects bound to a specific Postgres schema.
 *
 * The default exported table objects remain bound to `control_plane`. Test
 * environments use this factory to create the same typed table graph against a
 * throwaway schema inside a shared physical Postgres database.
 */
export function createControlPlaneDbSchema(schemaName: string) {
  const schema = pgSchema(schemaName);
  const accounts = defineAccounts(schema);
  const apiKeys = defineApiKeys(schema);
  const apiKeyPermissions = defineApiKeyPermissions(schema);
  const triggerConversationDeliveryProcessors = defineTriggerConversationDeliveryProcessors(schema);
  const triggerConversationDeliveryTasks = defineTriggerConversationDeliveryTasks(schema);
  const triggerConversationRoutes = defineTriggerConversationRoutes(schema);
  const triggerConversations = defineTriggerConversations(schema);
  const triggerRuns = defineTriggerRuns(schema);
  const triggerTargets = defineTriggerTargets(schema);
  const triggers = defineTriggers(schema);
  const identityLinkRedirectSessions = defineIdentityLinkRedirectSessions(schema);
  const integrationConnectionCredentials = defineIntegrationConnectionCredentials(schema);
  const integrationConnectionDeviceAuthorizationAttempts =
    defineIntegrationConnectionDeviceAuthorizationAttempts(schema);
  const integrationConnectionRedirectSessions = defineIntegrationConnectionRedirectSessions(schema);
  const integrationConnectionResourceStates = defineIntegrationConnectionResourceStates(schema);
  const integrationConnectionResources = defineIntegrationConnectionResources(schema);
  const integrationConnections = defineIntegrationConnections(schema);
  const integrationCredentials = defineIntegrationCredentials(schema);
  const integrationTargets = defineIntegrationTargets(schema);
  const integrationWebhookEvents = defineIntegrationWebhookEvents(schema);
  const integrationWebhookSources = defineIntegrationWebhookSources(schema);
  const invitations = defineInvitations(schema);
  const members = defineMembers(schema);
  const organizationBillingCustomers = defineOrganizationBillingCustomers(schema);
  const organizationCredentialKeys = defineOrganizationCredentialKeys(schema);
  const organizationIdentityLinkProviderConfigs =
    defineOrganizationIdentityLinkProviderConfigs(schema);
  const organizationSandboxStorageSettings = defineOrganizationSandboxStorageSettings(schema);
  const organizations = defineOrganizations(schema);
  const sandboxProfileSnapshotRefreshScheduleTargets =
    defineSandboxProfileSnapshotRefreshScheduleTargets(schema);
  const sandboxProfileVersionIntegrationBindings =
    defineSandboxProfileVersionIntegrationBindings(schema);
  const sandboxProfileVersionSnapshotJobs = defineSandboxProfileVersionSnapshotJobs(schema);
  const sandboxProfileVersions = defineSandboxProfileVersions(schema);
  const sandboxProfiles = defineSandboxProfiles(schema);
  const scheduleTriggers = defineScheduleTriggers(schema);
  const scheduledActions = defineScheduledActions(schema);
  const schedules = defineSchedules(schema);
  const sessions = defineSessions(schema);
  const teamMembers = defineTeamMembers(schema);
  const teams = defineTeams(schema);
  const userExternalPrincipalCredentialSecrets =
    defineUserExternalPrincipalCredentialSecrets(schema);
  const userExternalPrincipalCredentials = defineUserExternalPrincipalCredentials(schema);
  const userExternalPrincipalKeys = defineUserExternalPrincipalKeys(schema);
  const userExternalPrincipals = defineUserExternalPrincipals(schema);
  const users = defineUsers(schema);
  const verifications = defineVerifications(schema);
  const webhookTriggers = defineWebhookTriggers(schema);
  const integrationConnectionRelations = defineIntegrationConnectionRelations({
    integrationConnectionResourceStates,
    integrationConnectionResources,
    integrationConnections,
    integrationTargets,
    integrationWebhookEvents,
    integrationWebhookSources,
    userExternalPrincipals,
    users,
  });

  return {
    accounts,
    apiKeyPermissions,
    apiKeys,
    triggerConversationDeliveryProcessors,
    triggerConversationDeliveryTasks,
    triggerConversationRoutes,
    triggerConversations,
    triggerRuns,
    triggerTargets,
    triggers,
    identityLinkRedirectSessions,
    integrationConnectionCredentials,
    integrationConnectionDeviceAuthorizationAttempts,
    integrationConnectionRedirectSessions,
    integrationConnectionResourceStates,
    integrationConnectionResources,
    integrationConnections,
    integrationCredentials,
    integrationTargets,
    integrationWebhookEvents,
    integrationWebhookSources,
    invitations,
    members,
    organizationBillingCustomers,
    organizationCredentialKeys,
    organizationIdentityLinkProviderConfigs,
    organizationSandboxStorageSettings,
    organizations,
    sandboxProfileSnapshotRefreshScheduleTargets,
    sandboxProfileVersionIntegrationBindings,
    sandboxProfileVersionSnapshotJobs,
    sandboxProfileVersions,
    sandboxProfiles,
    scheduleTriggers,
    scheduledActions,
    schedules,
    sessions,
    teamMembers,
    teams,
    userExternalPrincipalCredentialSecrets,
    userExternalPrincipalCredentials,
    userExternalPrincipalKeys,
    userExternalPrincipals,
    users,
    verifications,
    webhookTriggers,
    ...integrationConnectionRelations,
  };
}

export type ControlPlaneDbSchema = ReturnType<typeof createControlPlaneDbSchema>;
