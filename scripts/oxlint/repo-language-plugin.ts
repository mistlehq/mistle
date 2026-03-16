import type { PluginModule, RuleContext, RuleListener, RuleModule } from "./types/plugin-types.ts";

const BannedHelperNames = new Set([
  "isRecord",
  "isObjectRecord",
  "toRecord",
  "asRecord",
  "resolveRecord",
  "toUnknownRecord",
  "asObjectRecord",
]);

const BannedAliasNames = new Set(["UnknownRecord", "ObjectRecord"]);

const BannedImportSuffixes = [
  "/is-record.js",
  "/is-record.ts",
  "/core/record.js",
  "/core/record.ts",
];

type AstNodeMap = {
  [key: string]: unknown;
};

type IdentifierNode = {
  type: "Identifier";
  name: string;
};

type StringLiteralNode = {
  type: "Literal";
  value: string;
};

type FunctionLikeNode = {
  type: "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression";
  id?: IdentifierNode | null;
  returnType?: TSTypeAnnotationNode | null;
};

type VariableDeclaratorNode = {
  type: "VariableDeclarator";
  id: unknown;
  init: unknown;
};

type MethodDefinitionNode = {
  type: "MethodDefinition";
  key: unknown;
  value: unknown;
};

type TSTypeAnnotationNode = {
  type: "TSTypeAnnotation";
  typeAnnotation: unknown;
};

type TSTypePredicateNode = {
  type: "TSTypePredicate";
  typeAnnotation: TSTypeAnnotationNode | null;
};

type TSTypeReferenceNode = {
  type: "TSTypeReference";
  typeName: unknown;
  typeArguments: TSTypeParameterInstantiationNode | null;
};

type TSTypeLiteralNode = {
  type: "TSTypeLiteral";
  members: unknown[];
};

type TSTypeParameterInstantiationNode = {
  type: "TSTypeParameterInstantiation";
  params: unknown[];
};

type TSUnknownKeywordNode = {
  type: "TSUnknownKeyword";
};

type TSTypeAliasDeclarationNode = {
  type: "TSTypeAliasDeclaration";
  id: IdentifierNode;
  typeAnnotation: unknown;
};

type TSInterfaceBodyNode = {
  type: "TSInterfaceBody";
  body: unknown[];
};

type TSInterfaceDeclarationNode = {
  type: "TSInterfaceDeclaration";
  id: IdentifierNode;
  body: unknown;
};

type TSIndexSignatureNode = {
  type: "TSIndexSignature";
  parameters: unknown[];
  typeAnnotation?: TSTypeAnnotationNode | null;
};

type IdentifierWithTypeAnnotationNode = IdentifierNode & {
  typeAnnotation?: TSTypeAnnotationNode | null;
};

type ImportDeclarationNode = {
  type: "ImportDeclaration";
  source: unknown;
};

function isAstNodeObject(value: unknown): value is AstNodeMap {
  return typeof value === "object" && value !== null;
}

function isIdentifierNode(node: unknown): node is IdentifierNode {
  return isAstNodeObject(node) && node.type === "Identifier" && typeof node.name === "string";
}

function isStringLiteralNode(node: unknown): node is StringLiteralNode {
  return isAstNodeObject(node) && node.type === "Literal" && typeof node.value === "string";
}

function isFunctionLikeNode(node: unknown): node is FunctionLikeNode {
  return (
    isAstNodeObject(node) &&
    (node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression")
  );
}

function isVariableDeclaratorNode(node: unknown): node is VariableDeclaratorNode {
  return isAstNodeObject(node) && node.type === "VariableDeclarator" && "id" in node;
}

function isMethodDefinitionNode(node: unknown): node is MethodDefinitionNode {
  return (
    isAstNodeObject(node) && node.type === "MethodDefinition" && "key" in node && "value" in node
  );
}

function isTSTypeAnnotationNode(node: unknown): node is TSTypeAnnotationNode {
  return isAstNodeObject(node) && node.type === "TSTypeAnnotation" && "typeAnnotation" in node;
}

function isTSTypePredicateNode(node: unknown): node is TSTypePredicateNode {
  return isAstNodeObject(node) && node.type === "TSTypePredicate" && "typeAnnotation" in node;
}

function isTSTypeReferenceNode(node: unknown): node is TSTypeReferenceNode {
  return isAstNodeObject(node) && node.type === "TSTypeReference" && "typeName" in node;
}

function isTSTypeLiteralNode(node: unknown): node is TSTypeLiteralNode {
  return isAstNodeObject(node) && node.type === "TSTypeLiteral" && Array.isArray(node.members);
}

function isTSTypeParameterInstantiationNode(
  node: unknown,
): node is TSTypeParameterInstantiationNode {
  return (
    isAstNodeObject(node) &&
    node.type === "TSTypeParameterInstantiation" &&
    Array.isArray(node.params)
  );
}

function isTSUnknownKeywordNode(node: unknown): node is TSUnknownKeywordNode {
  return isAstNodeObject(node) && node.type === "TSUnknownKeyword";
}

function isTSTypeAliasDeclarationNode(node: unknown): node is TSTypeAliasDeclarationNode {
  return (
    isAstNodeObject(node) && node.type === "TSTypeAliasDeclaration" && isIdentifierNode(node.id)
  );
}

function isTSInterfaceBodyNode(node: unknown): node is TSInterfaceBodyNode {
  return isAstNodeObject(node) && node.type === "TSInterfaceBody" && Array.isArray(node.body);
}

function isTSInterfaceDeclarationNode(node: unknown): node is TSInterfaceDeclarationNode {
  return (
    isAstNodeObject(node) &&
    node.type === "TSInterfaceDeclaration" &&
    isIdentifierNode(node.id) &&
    "body" in node
  );
}

function isTSIndexSignatureNode(node: unknown): node is TSIndexSignatureNode {
  return (
    isAstNodeObject(node) && node.type === "TSIndexSignature" && Array.isArray(node.parameters)
  );
}

function isIdentifierWithTypeAnnotationNode(
  node: unknown,
): node is IdentifierWithTypeAnnotationNode {
  return isIdentifierNode(node);
}

function isImportDeclarationNode(node: unknown): node is ImportDeclarationNode {
  return isAstNodeObject(node) && node.type === "ImportDeclaration" && "source" in node;
}

function readIdentifierName(node: unknown): string | null {
  return isIdentifierNode(node) ? node.name : null;
}

function isRecordTypeReference(node: unknown): boolean {
  if (!isTSTypeReferenceNode(node)) {
    return false;
  }

  const typeName = readIdentifierName(node.typeName);
  if (typeName !== "Record" || !isTSTypeParameterInstantiationNode(node.typeArguments)) {
    return false;
  }

  const [keyType, valueType] = node.typeArguments.params;
  return isStringKeywordNode(keyType) && isTSUnknownKeywordNode(valueType);
}

function isStringKeywordNode(node: unknown): boolean {
  return isAstNodeObject(node) && node.type === "TSStringKeyword";
}

function isGenericRecordTypeAnnotation(node: unknown): boolean {
  if (!isTSTypeAnnotationNode(node)) {
    return false;
  }

  return isGenericObjectTypeNode(node.typeAnnotation, new Set<string>());
}

function isGenericRecordTypePredicate(node: unknown): boolean {
  if (!isTSTypePredicateNode(node) || node.typeAnnotation === null) {
    return false;
  }

  return isGenericRecordTypeAnnotation(node.typeAnnotation);
}

function isStringIndexSignatureNode(node: unknown): boolean {
  if (!isTSIndexSignatureNode(node) || node.parameters.length !== 1) {
    return false;
  }

  const [parameter] = node.parameters;
  if (!isIdentifierWithTypeAnnotationNode(parameter) || parameter.typeAnnotation === undefined) {
    return false;
  }

  const parameterTypeAnnotation = parameter.typeAnnotation;
  if (
    !isTSTypeAnnotationNode(parameterTypeAnnotation) ||
    !isStringKeywordNode(parameterTypeAnnotation.typeAnnotation)
  ) {
    return false;
  }

  return (
    node.typeAnnotation !== undefined &&
    node.typeAnnotation !== null &&
    isTSTypeAnnotationNode(node.typeAnnotation) &&
    isTSUnknownKeywordNode(node.typeAnnotation.typeAnnotation)
  );
}

function hasGenericUnknownObjectIndexSignature(members: readonly unknown[]): boolean {
  return members.some((member) => isStringIndexSignatureNode(member));
}

function isGenericObjectTypeNode(
  node: unknown,
  genericObjectTypeNames: ReadonlySet<string>,
): boolean {
  if (isRecordTypeReference(node)) {
    return true;
  }

  if (isTSTypeLiteralNode(node)) {
    return hasGenericUnknownObjectIndexSignature(node.members);
  }

  if (!isTSTypeReferenceNode(node)) {
    return false;
  }

  const typeName = readIdentifierName(node.typeName);
  return typeName !== null && genericObjectTypeNames.has(typeName);
}

function reportBannedHelperName(context: RuleContext, node: unknown, name: string): void {
  if (!BannedHelperNames.has(name)) {
    return;
  }

  context.report({
    node,
    messageId: "bannedHelperName",
    data: { name },
  });
}

function reportGenericRecordReturnType(
  context: RuleContext,
  node: unknown,
  returnType: unknown,
  genericObjectTypeNames: ReadonlySet<string>,
): void {
  if (!isTSTypeAnnotationNode(returnType)) {
    return;
  }

  if (!isGenericObjectTypeNode(returnType.typeAnnotation, genericObjectTypeNames)) {
    return;
  }

  context.report({
    node,
    messageId: "bannedGenericObjectReturnType",
  });
}

const NoGenericRecordHelpersRule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow generic Record<string, unknown> helpers in favor of Zod boundaries, inline checks, or domain-specific local guards.",
    },
    schema: [],
    messages: {
      bannedAliasName:
        "Avoid the generic '{{name}}' alias. Use Zod at boundaries or a domain-specific named shape instead.",
      bannedGenericImport:
        "Avoid shared generic record utilities. Inline the check or use a domain-specific local helper.",
      bannedGenericObjectReturnType:
        "Avoid returning generic unknown-object map types. Push normalization to a boundary or use a domain-specific type.",
      bannedGenericObjectType:
        "Avoid generic unknown-object map type '{{name}}'. Push normalization to a boundary or use a domain-specific type.",
      bannedGenericRecordPredicate:
        "Avoid type predicates to Record<string, unknown>. Use an inline check or a domain-specific named shape.",
      bannedHelperName:
        "Avoid the generic '{{name}}' helper. Inline the check or use a domain-specific local helper.",
    },
  },
  create(context: RuleContext): RuleListener {
    const genericObjectTypeNames = new Set<string>();

    return {
      FunctionDeclaration(node): void {
        if (!isFunctionLikeNode(node)) {
          return;
        }

        const name = readIdentifierName(node.id);
        if (name !== null) {
          reportBannedHelperName(context, node, name);
        }

        reportGenericRecordReturnType(context, node, node.returnType, genericObjectTypeNames);
      },
      VariableDeclarator(node): void {
        if (!isVariableDeclaratorNode(node)) {
          return;
        }

        const name = readIdentifierName(node.id);
        if (name !== null) {
          reportBannedHelperName(context, node, name);
        }

        if (isFunctionLikeNode(node.init)) {
          reportGenericRecordReturnType(
            context,
            node.init,
            node.init.returnType,
            genericObjectTypeNames,
          );
        }
      },
      MethodDefinition(node): void {
        if (!isMethodDefinitionNode(node)) {
          return;
        }

        const name = readIdentifierName(node.key);
        if (name !== null) {
          reportBannedHelperName(context, node, name);
        }

        if (isFunctionLikeNode(node.value)) {
          reportGenericRecordReturnType(
            context,
            node.value,
            node.value.returnType,
            genericObjectTypeNames,
          );
        }
      },
      TSTypeAliasDeclaration(node): void {
        if (!isTSTypeAliasDeclarationNode(node)) {
          return;
        }

        if (BannedAliasNames.has(node.id.name)) {
          context.report({
            node,
            messageId: "bannedAliasName",
            data: { name: node.id.name },
          });
        }

        if (!isGenericObjectTypeNode(node.typeAnnotation, genericObjectTypeNames)) {
          return;
        }

        genericObjectTypeNames.add(node.id.name);
        context.report({
          node,
          messageId: "bannedGenericObjectType",
          data: { name: node.id.name },
        });
      },
      TSInterfaceDeclaration(node): void {
        if (!isTSInterfaceDeclarationNode(node) || !isTSInterfaceBodyNode(node.body)) {
          return;
        }

        if (!hasGenericUnknownObjectIndexSignature(node.body.body)) {
          return;
        }

        genericObjectTypeNames.add(node.id.name);
        context.report({
          node,
          messageId: "bannedGenericObjectType",
          data: { name: node.id.name },
        });
      },
      TSTypePredicate(node): void {
        if (!isTSTypePredicateNode(node) || !isGenericRecordTypePredicate(node)) {
          return;
        }

        context.report({
          node,
          messageId: "bannedGenericRecordPredicate",
        });
      },
      ImportDeclaration(node): void {
        if (!isImportDeclarationNode(node)) {
          return;
        }

        const source = node.source;
        if (!isStringLiteralNode(source)) {
          return;
        }

        if (!BannedImportSuffixes.some((suffix) => source.value.endsWith(suffix))) {
          return;
        }

        context.report({
          node,
          messageId: "bannedGenericImport",
        });
      },
    };
  },
};

const plugin: PluginModule = {
  meta: {
    name: "repo-language",
  },
  rules: {
    "no-generic-record-helpers": NoGenericRecordHelpersRule,
  },
};

export default plugin;
