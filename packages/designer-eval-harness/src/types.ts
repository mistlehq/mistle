export type DesignerEvalCase = {
  id: string;
  expectedOutcomePath: string;
  prompt: string;
  seed: DesignerEvalSeed;
  scriptedInputs: Record<string, DesignerEvalInputResponse>;
  assertions: readonly DesignerEvalAssertion[];
};

export type DesignerEvalSeed = {
  providerConnections?: readonly DesignerEvalSeedProviderConnection[] | undefined;
  providerResources?: readonly DesignerEvalSeedProviderResource[] | undefined;
  targetDraft: {
    initialIntegrationBindings?: readonly DesignerEvalProductStateIntegrationBinding[] | undefined;
    profileId: string;
    version: number;
  };
};

export type DesignerEvalSeedProviderConnection = {
  id: string;
  label: string;
  providerFamilyId: string;
  targetKey: string;
};

export type DesignerEvalSeedProviderResource = {
  connectionId: string;
  handle: string;
  kind: string;
};

export type DesignerEvalSeededState = {
  providerConnections: readonly DesignerEvalSeedProviderConnection[];
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
      kind: "blueprint-core-node-count-at-most";
      maxItems: number;
    }
  | {
      kind: "blueprint-has-provider-lifecycle";
      requiredConcepts: readonly string[];
    }
  | {
      kind: "blueprint-excludes-setup-nodes";
      disallowedConcepts: readonly string[];
    }
  | {
      kind: "required-binding-tools-present";
      connectionId: string;
      tools: readonly string[];
    }
  | {
      kind: "setup-incompleteness-disclosed";
      requiredPhrases: readonly string[];
    }
  | {
      kind: "saved-selected-provider-resources";
      connectionId: string;
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
  providerConnections: readonly DesignerEvalSeedProviderConnection[];
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

export type DesignerEvalJudgeFindingCategory =
  | "harness_issue"
  | "designer_behavior_issue"
  | "product_capability_gap"
  | "ambiguous_case";

export type DesignerEvalJudgeResult = {
  verdict: "pass" | "fail" | "inconclusive";
  failureCategory:
    | "none"
    | "harness_issue"
    | "designer_behavior_issue"
    | "product_capability_gap"
    | "ambiguous_case";
  scores: {
    conversationFlow: number;
    factoryProcessClarity: number;
    agentRoleSeparation: number;
    feedbackLoopQuality: number;
    honestHandoff: number;
  };
  findings: readonly {
    severity: "low" | "medium" | "high";
    category: DesignerEvalJudgeFindingCategory;
    evidence: string;
    suggestedFix: string;
  }[];
};
