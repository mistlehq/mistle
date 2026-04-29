import { Notice } from "@mistle/ui";

import { ManifestJsonEditor, type ManifestJsonValidation } from "./manifest-json-editor.js";
import type { ManifestWebhookCallbackState } from "./manifest-webhook-callback-state.js";

export function ManifestCallbackJsonEditor(input: {
  id: string;
  callbackState: ManifestWebhookCallbackState;
  onChange: (value: string) => void;
  validation: ManifestJsonValidation;
  value: string;
}): React.JSX.Element {
  if (input.callbackState.kind === "ready") {
    return (
      <ManifestJsonEditor
        id={input.id}
        onChange={input.onChange}
        validation={input.validation}
        value={input.value}
      />
    );
  }

  if (input.callbackState.kind === "loading") {
    return <Notice>Loading manifest callback URLs...</Notice>;
  }

  return (
    <Notice title="Could not load manifest callback URLs" variant="alert">
      {input.callbackState.kind === "error"
        ? input.callbackState.message
        : "The integration webhook source is missing a callback URL."}
    </Notice>
  );
}
