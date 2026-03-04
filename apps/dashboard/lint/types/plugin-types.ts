export interface RuleContext {
  report(input: { node: unknown; messageId: string; data?: Record<string, string> }): void;
}

export interface RuleListener {
  Program?(node: unknown): void;
  JSXOpeningElement?(node: unknown): void;
}

export interface RuleModule {
  meta: {
    type: "problem" | "suggestion" | "layout";
    docs: {
      description: string;
    };
    schema: unknown[];
    messages: Record<string, string>;
  };
  create(context: RuleContext): RuleListener;
}

export interface PluginModule {
  meta: {
    name: string;
  };
  rules: Record<string, RuleModule>;
}
