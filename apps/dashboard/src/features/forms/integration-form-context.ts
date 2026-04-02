import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";

/**
 * Global layout mode for schema-driven integration forms.
 *
 * Contract:
 * - `vertical` is the default and stacks labels above controls.
 * - `horizontal` renders rows using the shared `Field` horizontal layout.
 * - individual fields may opt out of the horizontal row treatment by setting
 *   `ui:options.layout` to `"stacked"` in their uiSchema.
 */
export type IntegrationFormLayout = "vertical" | "horizontal";

export type IntegrationFormResourceOverride = {
  connectionId: string;
  kind: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
  lastSyncedAt?: string | undefined;
  lastErrorMessage?: string | undefined;
  items: readonly IntegrationConnectionResource[];
};

export type IntegrationFormContext = {
  /**
   * Form-wide default layout for RJSF surfaces using the shared integration
   * theme. This is intentionally a small API that mirrors the patterns we use
   * in hand-built dashboard forms:
   * - set the form to `horizontal` when the editor is primarily row-based
   * - leave it `vertical` for dialog-style or stacked forms
   * - use field-level `ui:options.layout = "stacked"` for large fields that
   *   should remain vertical inside an otherwise horizontal form
   */
  layout?: IntegrationFormLayout;
  resourceOverrides?: readonly IntegrationFormResourceOverride[] | undefined;
};
