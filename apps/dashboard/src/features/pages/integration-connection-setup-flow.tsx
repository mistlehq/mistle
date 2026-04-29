import { CopyableValue, Notice, Tabs, TabsContent, TabsList, TabsTrigger } from "@mistle/ui";

import {
  ManifestJsonEditor,
  type ManifestJsonValidation,
} from "../integrations/manifest-json-editor.js";
import type { ManifestWebhookCallbackState } from "../integrations/manifest-webhook-callback-state.js";
import { FormPageSection } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";

export type IntegrationConnectionSetupMode = "manifest" | "existing-app";

export function IntegrationConnectionSetupModeTabs(input: {
  actionErrorMessage: string | null;
  description: string;
  existingAppContent: React.ReactNode;
  footer: React.ReactNode;
  manifestContent: React.ReactNode;
  onModeChange: (mode: IntegrationConnectionSetupMode) => void;
  title: string;
  value: IntegrationConnectionSetupMode;
}): React.JSX.Element {
  return (
    <Tabs
      onValueChange={(nextValue) => {
        if (nextValue === "manifest" || nextValue === "existing-app") {
          input.onModeChange(nextValue);
        }
      }}
      value={input.value}
    >
      <SectionHeader
        className="px-1"
        description={input.description}
        size="large"
        title={input.title}
      />

      <FormPageSection>
        <div className="flex flex-col gap-6 p-4">
          <TabsList className="w-full">
            <TabsTrigger value="manifest">Create from manifest</TabsTrigger>
            <TabsTrigger value="existing-app">Use existing app</TabsTrigger>
          </TabsList>

          {input.actionErrorMessage === null ? null : (
            <Notice title="Could not continue setup" variant="alert">
              {input.actionErrorMessage}
            </Notice>
          )}

          <TabsContent value="manifest">{input.manifestContent}</TabsContent>
          <TabsContent value="existing-app">{input.existingAppContent}</TabsContent>

          {input.footer}
        </div>
      </FormPageSection>
    </Tabs>
  );
}

export function IntegrationConnectionSetupWebhookCallbackValue(input: {
  errorTitle: string;
  label: string;
  missingMessage: string;
  missingTitle: string;
  webhookCallbackState: ManifestWebhookCallbackState;
}): React.JSX.Element {
  if (input.webhookCallbackState.kind === "loading") {
    return <CopyableValue label={input.label} loading />;
  }

  if (input.webhookCallbackState.kind === "error") {
    return (
      <Notice title={input.errorTitle} variant="alert">
        {input.webhookCallbackState.message}
      </Notice>
    );
  }

  if (input.webhookCallbackState.kind === "missing") {
    return (
      <Notice title={input.missingTitle} variant="alert">
        {input.missingMessage}
      </Notice>
    );
  }

  return <CopyableValue label={input.label} value={input.webhookCallbackState.value} />;
}

export function IntegrationConnectionSetupManifestEditorSection(input: {
  description: string;
  editorId: string;
  headingLevel?: "h2" | "h3";
  manifestCallbackState: ManifestWebhookCallbackState;
  manifestValidation: ManifestJsonValidation;
  manifestValue: string;
  onManifestChange: (value: string) => void;
  title: string;
}): React.JSX.Element {
  const titleClassName = "text-base font-medium";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        {input.headingLevel === "h3" ? (
          <h3 className={titleClassName}>{input.title}</h3>
        ) : (
          <h2 className={titleClassName}>{input.title}</h2>
        )}
        <p className="text-muted-foreground text-sm">{input.description}</p>
      </div>
      {input.manifestCallbackState.kind === "ready" ? (
        <ManifestJsonEditor
          id={input.editorId}
          onChange={input.onManifestChange}
          validation={input.manifestValidation}
          value={input.manifestValue}
        />
      ) : input.manifestCallbackState.kind === "loading" ? (
        <Notice>Loading manifest callback URLs...</Notice>
      ) : (
        <Notice title="Could not load manifest callback URLs" variant="alert">
          {input.manifestCallbackState.kind === "error"
            ? input.manifestCallbackState.message
            : "The integration webhook source is missing a callback URL."}
        </Notice>
      )}
    </div>
  );
}
