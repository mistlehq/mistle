export type DesignerEvalCase = {
  id: string;
  prompt: string;
  seed: DesignerEvalSeed;
  scriptedInputs: Record<string, DesignerEvalInputResponse>;
  assertions: readonly DesignerEvalAssertion[];
};

export type DesignerEvalSeed = {
  githubRepositoryHandles: readonly string[];
  targetDraft: {
    profileId: string;
    version: number;
  };
};

export type DesignerEvalSeededState = {
  githubConnectionId: string;
  targetDraft: {
    profileId: string;
    version: number;
  };
};

export type DesignerEvalInputResponse =
  | {
      kind: "answers";
      answers: readonly DesignerEvalAnswer[];
    }
  | {
      kind: "customResponse";
      text: string;
    }
  | {
      kind: "cancel";
    };

export type DesignerEvalAnswer = {
  id: string;
  value: string | readonly string[];
};

export type DesignerEvalAssertion =
  | {
      kind: "blueprint-before-product-mutation";
    }
  | {
      kind: "saved-selected-provider-resources";
      profileId: string;
      version: number;
      connectionId: string;
      resourceKind: string;
      bindingIntent: string;
      selectedHandles: readonly string[];
    }
  | {
      kind: "user-input-requested";
      inputId: string;
    };

export type DesignerEvalDashboardControlAction =
  | {
      sequence: number;
      kind: "show_designer_canvas_tab";
      tabKind: "route" | "blueprint";
      input: unknown;
      response: unknown;
    }
  | {
      sequence: number;
      kind: "request_user_input";
      inputId: string;
      input: unknown;
      response: unknown;
    }
  | {
      sequence: number;
      kind: "unsupported";
      method: string;
      input: unknown;
      response: unknown;
    };

export type DesignerEvalProductState = {
  availableProviderResources: readonly {
    connectionId: string;
    kind: string;
    handle: string;
  }[];
  targetDraft: {
    profileId: string;
    version: number;
    integrationBindings: readonly DesignerEvalProductStateIntegrationBinding[];
  };
};

export type DesignerEvalProductStateIntegrationBinding = {
  id: string;
  connectionId: string;
  kind: string;
  config: unknown;
};

export type DesignerEvalResult = {
  caseId: string;
  passed: boolean;
  checks: readonly DesignerEvalCheckResult[];
};

export type DesignerEvalCheckResult = {
  passed: boolean;
  label: string;
  detail: string;
};
