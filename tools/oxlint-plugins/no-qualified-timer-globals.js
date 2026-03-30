const QualifiedTimerGlobalNames = new Set(["window", "globalThis"]);
const QualifiedTimerMethodNames = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
]);

function getRestrictedTimerMember(node) {
  if (node.type !== "MemberExpression" || node.computed) {
    return null;
  }

  if (node.object.type !== "Identifier" || node.property.type !== "Identifier") {
    return null;
  }

  if (
    !QualifiedTimerGlobalNames.has(node.object.name) ||
    !QualifiedTimerMethodNames.has(node.property.name)
  ) {
    return null;
  }

  return {
    objectName: node.object.name,
    propertyName: node.property.name,
  };
}

function isTypeQueryMemberExpression(node) {
  return node.parent?.type === "TSTypeQuery";
}

const noQualifiedTimerGlobalsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow qualified timer globals such as window.setTimeout.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const restrictedTimerMember = getRestrictedTimerMember(node);
        if (restrictedTimerMember === null || isTypeQueryMemberExpression(node)) {
          return;
        }

        context.report({
          node,
          message: `Use @mistle/time abstractions instead of ${restrictedTimerMember.objectName}.${restrictedTimerMember.propertyName}.`,
        });
      },
    };
  },
};

const plugin = {
  meta: {
    name: "mistle",
  },
  rules: {
    "no-qualified-timer-globals": noQualifiedTimerGlobalsRule,
  },
};

export default plugin;
