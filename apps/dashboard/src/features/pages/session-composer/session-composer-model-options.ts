import type { SessionComposerBootstrapResult } from "./session-composer-runtime-contracts.js";

export type SessionComposerModelOption = {
  value: string;
  label: string;
};

export function buildSessionComposerModelOptions(
  availableModels: SessionComposerBootstrapResult["establishedSnapshot"]["availableModels"],
  includeDefaultMarker: boolean,
): readonly SessionComposerModelOption[] {
  return availableModels.map((model) => ({
    value: model.model,
    label:
      includeDefaultMarker && model.isDefault
        ? `${model.displayName} (default)`
        : model.displayName,
  }));
}
