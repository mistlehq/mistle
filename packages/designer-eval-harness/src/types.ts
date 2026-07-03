export type DesignerEvalCase = {
  id: string;
  expectedOutcomePath: string;
  prompt: string;
  followUpPrompts?: readonly string[] | undefined;
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
      kind: "product-mutation-not-before-turn";
      minTurnIndex: number;
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
      kind: "required-agent-model-provider-binding";
      connectionId: string;
      compatibleTargetKeys: readonly string[];
    }
  | {
      kind: "setup-incompleteness-disclosed";
      requiredPhrases: readonly string[];
    }
  | {
      kind: "configured-tools-not-claimed-missing";
      connectionTools: readonly {
        connectionId: string;
        tools: readonly string[];
      }[];
      forbiddenPhrases: readonly string[];
    }
  | {
      kind: "transcript-excludes-internal-progress";
      forbiddenPhrases: readonly string[];
    }
  | {
      kind: "transcript-includes-required-phrases";
      label: string;
      requiredPhrases: readonly string[];
    }
  | {
      kind: "transcript-includes-sections";
      label: string;
      requiredSections: readonly string[];
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
      turnIndex?: number | undefined;
      tabKind: "route" | "blueprint";
      input: unknown;
      response: unknown;
    }
  | {
      sequence: number;
      kind: "request_user_input";
      turnIndex?: number | undefined;
      inputId: string;
      input: unknown;
      response: unknown;
    }
  | {
      sequence: number;
      kind: "unsupported";
      turnIndex?: number | undefined;
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
    readinessDisclosure: number;
  };
  findings: readonly {
    severity: "low" | "medium" | "high";
    category: DesignerEvalJudgeFindingCategory;
    evidence: string;
    suggestedFix: string;
  }[];
};
