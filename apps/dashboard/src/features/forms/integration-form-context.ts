import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";

export type IntegrationFormResourceOverride = {
  connectionId: string;
  kind: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
  lastSyncedAt?: string | undefined;
  lastErrorMessage?: string | undefined;
  items: readonly IntegrationConnectionResource[];
};

export type IntegrationFormContext = {
  layout?: "vertical" | "horizontal";
  resourceOverrides?: readonly IntegrationFormResourceOverride[] | undefined;
};
