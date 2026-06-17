import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { resolveRemoteMcpServers } from "../../../shared/remote-mcp-server-catalog/index.js";
import {
  type GoogleWorkspaceConnectionConfig,
  GoogleWorkspaceConnectionMethodIds,
  GoogleWorkspaceConnectionConfigSchema,
  GoogleWorkspaceConnectionStartConfigSchema,
  GoogleWorkspaceCredentialSecretTypes,
  GoogleWorkspaceServiceAccountConnectionConfigSchema,
  GoogleWorkspaceServiceAccountCredentialSlotKeys,
} from "./auth.js";
import { resolveGoogleWorkspaceBindingConfigForm } from "./binding-config-form.js";
import { GoogleWorkspaceBindingConfigSchema } from "./binding-config-schema.js";
import { compileGoogleWorkspaceBinding } from "./compile-binding.js";
import { GoogleWorkspaceServiceAccountConnectionConfigForm } from "./connection-config-form.js";
import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";
import { GoogleWorkspaceTargetConfigSchema } from "./target-config-schema.js";
import { GoogleWorkspaceTargetSecretSchema } from "./target-secret-schema.js";
import { validateGoogleWorkspaceBindingWriteContext } from "./validate-binding-write-context.js";

export type GoogleWorkspaceMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof GoogleWorkspaceTargetConfigSchema,
  typeof GoogleWorkspaceTargetSecretSchema,
  typeof GoogleWorkspaceBindingConfigSchema,
  GoogleWorkspaceConnectionConfig
>;

export const GoogleWorkspaceMcpBaseDefinition: GoogleWorkspaceMcpBaseIntegrationDefinition = {
  familyId: "google-workspace",
  variantId: "google-workspace-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Google Workspace",
  description:
    "Enable Google-hosted Workspace MCP access for Gmail, Drive, Calendar, Chat, and People.",
  logoKey: "google",
  targetConfigSchema: GoogleWorkspaceTargetConfigSchema,
  targetSecretSchema: GoogleWorkspaceTargetSecretSchema,
  bindingConfigSchema: GoogleWorkspaceBindingConfigSchema,
  bindingConfigForm: resolveGoogleWorkspaceBindingConfigForm,
  validateBindingWriteContext: validateGoogleWorkspaceBindingWriteContext,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Google OAuth",
      kind: "redirect",
      configSchema: GoogleWorkspaceConnectionConfigSchema,
      startConfigSchema: GoogleWorkspaceConnectionStartConfigSchema,
      startConfigForm: () => ({
        schema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              title: "OAuth client ID",
            },
            client_secret: {
              type: "string",
              title: "OAuth client secret",
            },
          },
          required: ["client_id", "client_secret"],
        },
        uiSchema: {
          client_id: {
            "ui:placeholder": "1234567890-abc.apps.googleusercontent.com",
          },
          client_secret: {
            "ui:widget": "password",
          },
        },
      }),
      ui: {
        create: {
          submitLabel: "Connect Google Workspace",
          helperText: "Authorize Google Workspace access with your Google OAuth client.",
          showCallbackUrl: true,
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
    {
      id: GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
      label: "Service account",
      kind: "form",
      secretFields: [
        {
          name: "serviceAccountKeyJson",
          label: "Service account JSON key",
          placeholder: '{"type":"service_account",...}',
          description: "JSON key for a Google Cloud service account.",
          inputType: "textarea",
          secretType: GoogleWorkspaceCredentialSecretTypes.SERVICE_ACCOUNT_KEY_JSON,
          slotKey: GoogleWorkspaceServiceAccountCredentialSlotKeys.SERVICE_ACCOUNT_KEY_JSON,
        },
      ],
      configSchema: GoogleWorkspaceServiceAccountConnectionConfigSchema,
      configForm: GoogleWorkspaceServiceAccountConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    resolveRemoteMcpServers({
      catalog: GoogleWorkspaceMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
    }),
  compileBinding: compileGoogleWorkspaceBinding,
};
