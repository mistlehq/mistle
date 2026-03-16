export interface RuleContext {
  report(input: { node: unknown; messageId: string; data?: Record<string, string> }): void;
}

export type NodeListener = (node: unknown) => void;

export type RuleListener = Record<string, NodeListener | undefined> & {
  FunctionDeclaration?: NodeListener;
  VariableDeclarator?: NodeListener;
  MethodDefinition?: NodeListener;
  TSTypeAliasDeclaration?: NodeListener;
  TSTypePredicate?: NodeListener;
  ImportDeclaration?: NodeListener;
};

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
