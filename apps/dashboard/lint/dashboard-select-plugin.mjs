const UI_PACKAGE_NAME = "@mistle/ui";
const SELECT_IMPORT_NAME = "Select";

function isIdentifierWithName(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

function unwrapParentheses(expression) {
  let current = expression;
  while (current?.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function isUndefinedExpression(expression) {
  const unwrapped = unwrapParentheses(expression);
  if (unwrapped?.type === "Identifier" && unwrapped.name === "undefined") {
    return true;
  }
  return (
    unwrapped?.type === "UnaryExpression" &&
    unwrapped.operator === "void" &&
    unwrapped.argument?.type === "Literal" &&
    unwrapped.argument.value === 0
  );
}

function hasUndefinedSelectValue(expression) {
  const unwrapped = unwrapParentheses(expression);
  if (isUndefinedExpression(unwrapped)) {
    return true;
  }

  if (unwrapped?.type === "ConditionalExpression") {
    return (
      isUndefinedExpression(unwrapped.consequent) || isUndefinedExpression(unwrapped.alternate)
    );
  }

  return (
    unwrapped?.type === "LogicalExpression" &&
    unwrapped.operator === "??" &&
    isUndefinedExpression(unwrapped.right)
  );
}

const noUndefinedSelectValueRule = {
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
  create(context) {
    const selectLocalNames = new Set();

    function collectSelectImports(program) {
      for (const statement of program.body) {
        if (statement.type !== "ImportDeclaration") {
          continue;
        }
        if (statement.source?.type !== "Literal" || statement.source.value !== UI_PACKAGE_NAME) {
          continue;
        }

        for (const specifier of statement.specifiers) {
          if (specifier.type !== "ImportSpecifier") {
            continue;
          }
          if (!isIdentifierWithName(specifier.imported, SELECT_IMPORT_NAME)) {
            continue;
          }
          if (specifier.local?.type === "Identifier") {
            selectLocalNames.add(specifier.local.name);
          }
        }
      }
    }

    function checkSelectValueAttribute(node) {
      if (node.name?.type !== "JSXIdentifier") {
        return;
      }
      if (!selectLocalNames.has(node.name.name)) {
        return;
      }

      for (const attribute of node.attributes) {
        if (attribute.type !== "JSXAttribute") {
          continue;
        }
        if (attribute.name?.type !== "JSXIdentifier" || attribute.name.name !== "value") {
          continue;
        }
        if (attribute.value?.type !== "JSXExpressionContainer") {
          continue;
        }

        const expression = attribute.value.expression;
        if (expression == null || expression.type === "JSXEmptyExpression") {
          continue;
        }
        if (!hasUndefinedSelectValue(expression)) {
          continue;
        }

        context.report({ node: attribute, messageId: "avoidUndefined" });
      }
    }

    return {
      Program(node) {
        collectSelectImports(node);
      },
      JSXOpeningElement(node) {
        checkSelectValueAttribute(node);
      },
    };
  },
};

const plugin = {
  meta: {
    name: "dashboard-select",
  },
  rules: {
    "no-undefined-select-value": noUndefinedSelectValueRule,
  },
};

export default plugin;
