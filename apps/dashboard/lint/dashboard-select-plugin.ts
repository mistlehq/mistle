import type { PluginModule, RuleContext, RuleListener, RuleModule } from "./types/plugin-types.ts";

const UI_PACKAGE_NAME = "@mistle/ui";
const SELECT_IMPORT_NAME = "Select";

type AstNodeObject = {
  [key: string]: unknown;
};

interface IdentifierNode {
  type: "Identifier";
  name: string;
}

interface ImportSpecifierNode {
  type: "ImportSpecifier";
  imported: unknown;
  local: unknown;
}

interface ImportDeclarationNode {
  type: "ImportDeclaration";
  source: unknown;
  specifiers: unknown[];
}

interface ProgramNode {
  body: unknown[];
}

interface ParenthesizedExpressionNode {
  type: "ParenthesizedExpression";
  expression: unknown;
}

interface JSXIdentifierNode {
  type: "JSXIdentifier";
  name: string;
}

interface JSXAttributeNode {
  type: "JSXAttribute";
  name: unknown;
  value?: unknown;
}

interface JSXExpressionContainerNode {
  type: "JSXExpressionContainer";
  expression: unknown;
}

interface JSXOpeningElementNode {
  name: unknown;
  attributes: unknown[];
}

interface ConditionalExpressionNode {
  type: "ConditionalExpression";
  consequent: unknown;
  alternate: unknown;
}

interface LogicalExpressionNode {
  type: "LogicalExpression";
  operator: string;
  right: unknown;
}

interface UnaryExpressionNode {
  type: "UnaryExpression";
  operator: string;
  argument: unknown;
}

interface LiteralNode {
  type: "Literal";
  value: unknown;
}

function isAstNodeObject(value: unknown): value is AstNodeObject {
  return typeof value === "object" && value !== null;
}

function isIdentifierNode(node: unknown): node is IdentifierNode {
  return isAstNodeObject(node) && node.type === "Identifier" && typeof node.name === "string";
}

function isImportSpecifierNode(node: unknown): node is ImportSpecifierNode {
  return (
    isAstNodeObject(node) &&
    node.type === "ImportSpecifier" &&
    "imported" in node &&
    "local" in node
  );
}

function isImportDeclarationNode(node: unknown): node is ImportDeclarationNode {
  return (
    isAstNodeObject(node) &&
    node.type === "ImportDeclaration" &&
    "source" in node &&
    Array.isArray(node.specifiers)
  );
}

function isProgramNode(node: unknown): node is ProgramNode {
  return isAstNodeObject(node) && Array.isArray(node.body);
}

function isParenthesizedExpressionNode(node: unknown): node is ParenthesizedExpressionNode {
  return isAstNodeObject(node) && node.type === "ParenthesizedExpression" && "expression" in node;
}

function isJSXIdentifierNode(node: unknown): node is JSXIdentifierNode {
  return isAstNodeObject(node) && node.type === "JSXIdentifier" && typeof node.name === "string";
}

function isJSXAttributeNode(node: unknown): node is JSXAttributeNode {
  return isAstNodeObject(node) && node.type === "JSXAttribute" && "name" in node;
}

function isJSXExpressionContainerNode(node: unknown): node is JSXExpressionContainerNode {
  return isAstNodeObject(node) && node.type === "JSXExpressionContainer" && "expression" in node;
}

function isJSXOpeningElementNode(node: unknown): node is JSXOpeningElementNode {
  return isAstNodeObject(node) && "name" in node && Array.isArray(node.attributes);
}

function isLiteralStringNode(node: unknown): node is LiteralNode & { value: string } {
  return isAstNodeObject(node) && node.type === "Literal" && typeof node.value === "string";
}

function isLiteralZeroNode(node: unknown): node is LiteralNode {
  return isAstNodeObject(node) && node.type === "Literal" && "value" in node && node.value === 0;
}

function isUnaryVoidExpressionNode(node: unknown): node is UnaryExpressionNode {
  return (
    isAstNodeObject(node) &&
    node.type === "UnaryExpression" &&
    node.operator === "void" &&
    "argument" in node
  );
}

function isConditionalExpressionNode(node: unknown): node is ConditionalExpressionNode {
  return (
    isAstNodeObject(node) &&
    node.type === "ConditionalExpression" &&
    "consequent" in node &&
    "alternate" in node
  );
}

function isLogicalExpressionNode(node: unknown): node is LogicalExpressionNode {
  return (
    isAstNodeObject(node) &&
    node.type === "LogicalExpression" &&
    "operator" in node &&
    "right" in node
  );
}

function isJSXEmptyExpressionNode(node: unknown): boolean {
  return isAstNodeObject(node) && node.type === "JSXEmptyExpression";
}

function isIdentifierWithName(node: unknown, name: string): boolean {
  return isIdentifierNode(node) && node.name === name;
}

function unwrapParentheses(expression: unknown): unknown {
  let current: unknown = expression;
  while (isParenthesizedExpressionNode(current)) {
    current = current.expression;
  }
  return current;
}

function isUndefinedExpression(expression: unknown): boolean {
  const unwrapped = unwrapParentheses(expression);
  if (isIdentifierWithName(unwrapped, "undefined")) {
    return true;
  }

  if (!isUnaryVoidExpressionNode(unwrapped)) {
    return false;
  }

  return isLiteralZeroNode(unwrapped.argument);
}

function hasUndefinedSelectValue(expression: unknown): boolean {
  const unwrapped = unwrapParentheses(expression);
  if (isUndefinedExpression(unwrapped)) {
    return true;
  }

  if (isConditionalExpressionNode(unwrapped)) {
    return (
      isUndefinedExpression(unwrapped.consequent) || isUndefinedExpression(unwrapped.alternate)
    );
  }

  if (!isLogicalExpressionNode(unwrapped) || unwrapped.operator !== "??") {
    return false;
  }

  return isUndefinedExpression(unwrapped.right);
}

function collectSelectImports(programNode: unknown, selectLocalNames: Set<string>): void {
  if (!isProgramNode(programNode)) {
    return;
  }

  for (const statement of programNode.body) {
    if (!isImportDeclarationNode(statement)) {
      continue;
    }
    if (!isLiteralStringNode(statement.source) || statement.source.value !== UI_PACKAGE_NAME) {
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (!isImportSpecifierNode(specifier)) {
        continue;
      }
      if (!isIdentifierWithName(specifier.imported, SELECT_IMPORT_NAME)) {
        continue;
      }
      if (!isIdentifierNode(specifier.local)) {
        continue;
      }
      selectLocalNames.add(specifier.local.name);
    }
  }
}

function checkSelectValueAttribute(
  node: unknown,
  selectLocalNames: Set<string>,
  context: RuleContext,
): void {
  if (!isJSXOpeningElementNode(node)) {
    return;
  }
  if (!isJSXIdentifierNode(node.name) || !selectLocalNames.has(node.name.name)) {
    return;
  }

  for (const attribute of node.attributes) {
    if (!isJSXAttributeNode(attribute)) {
      continue;
    }
    if (!isJSXIdentifierNode(attribute.name) || attribute.name.name !== "value") {
      continue;
    }
    if (!isJSXExpressionContainerNode(attribute.value)) {
      continue;
    }

    const expression = attribute.value.expression;
    if (isJSXEmptyExpressionNode(expression)) {
      continue;
    }
    if (!hasUndefinedSelectValue(expression)) {
      continue;
    }

    context.report({ node: attribute, messageId: "avoidUndefined" });
  }
}

const noUndefinedSelectValueRule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent Select components from passing undefined to value to avoid controlled/uncontrolled transitions.",
    },
    schema: [],
    messages: {
      avoidUndefined:
        "Select value must remain controlled. Avoid undefined in value expression; use empty-string sentinel.",
    },
  },
  create(context: RuleContext): RuleListener {
    const selectLocalNames = new Set<string>();

    return {
      Program(node: unknown): void {
        collectSelectImports(node, selectLocalNames);
      },
      JSXOpeningElement(node: unknown): void {
        checkSelectValueAttribute(node, selectLocalNames, context);
      },
    };
  },
};

const plugin: PluginModule = {
  meta: {
    name: "dashboard-select",
  },
  rules: {
    "no-undefined-select-value": noUndefinedSelectValueRule,
  },
};

export default plugin;
