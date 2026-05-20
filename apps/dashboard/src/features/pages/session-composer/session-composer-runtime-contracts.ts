import type { ComposerCapability } from "@mistle/integrations-core";

import type { ComposerConfigSnapshot } from "./session-composer-config.js";

export type SessionComposerModel = {
  model: string;
  displayName: string;
  defaultReasoningEffort: string | null;
  inputModalities: readonly string[];
  isDefault: boolean;
};

export type SessionComposerBootstrapPhase =
  | { status: "unavailable" }
  | { status: "bootstrapping" }
  | { status: "ready" }
  | { status: "failed"; message: string };

export type SessionComposerBootstrapResult = {
  phase: SessionComposerBootstrapPhase;
  composerCapabilities: readonly ComposerCapability[];
  establishedSnapshot: {
    availableModels: readonly SessionComposerModel[];
    configSnapshot: ComposerConfigSnapshot;
  };
};

export type SessionComposerSubmittedLocalImageAttachment = {
  type: "localImage";
  path: string;
};

export type SessionComposerCollaborationModeSettings = {
  mode: "default" | "plan";
  model: string;
  reasoningEffort: string | null;
  developerInstructions: string | null;
};
