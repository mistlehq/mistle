import { CopyableValue, Notice, Tabs, TabsContent, TabsList, TabsTrigger } from "@mistle/ui";

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
