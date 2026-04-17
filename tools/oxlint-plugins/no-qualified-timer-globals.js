const QualifiedTimerGlobalNames = new Set(["window", "globalThis"]);
const QualifiedTimerMethodNames = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
]);
const RestrictedTestingMemberMessages = new Map([
  [
    "vi",
    new Map([
      ["fn", "Do not use vi.fn mocks/stubs. Assert observable behavior instead."],
      ["spyOn", "Do not use vi.spyOn. Assert observable behavior instead."],
      ["mock", "Do not use vi.mock. Assert observable behavior instead."],
      ["mocked", "Do not use vi.mocked. Assert observable behavior instead."],
      ["stubGlobal", "Do not stub globals in tests. Assert observable behavior instead."],
    ]),
  ],
  [
    "jest",
    new Map([
      ["fn", "Do not use jest.fn mocks/stubs. Assert observable behavior instead."],
      ["spyOn", "Do not use jest.spyOn. Assert observable behavior instead."],
      ["mock", "Do not use jest.mock. Assert observable behavior instead."],
      ["mocked", "Do not use jest.mocked. Assert observable behavior instead."],
    ]),
  ],
  [
    "sinon",
    new Map([
      ["stub", "Do not use sinon stubs. Assert observable behavior instead."],
      ["spy", "Do not use sinon spies. Assert observable behavior instead."],
      ["mock", "Do not use sinon mocks. Assert observable behavior instead."],
    ]),
  ],
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

function getIdentifierName(node) {
  if (node.type !== "Identifier") {
    return null;
  }

  return node.name;
}

function getStaticPropertyName(node) {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  if (!node.computed) {
    return null;
  }

  if (node.property.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value;
  }

  if (node.property.type === "StringLiteral") {
    return node.property.value;
  }

  return null;
}

function getRestrictedTestingMemberMessage(objectName, propertyName) {
  return RestrictedTestingMemberMessages.get(objectName)?.get(propertyName) ?? null;
}

function getRestrictedTestingMember(node) {
  if (node.type !== "MemberExpression") {
    return null;
  }

  const objectName = getIdentifierName(node.object);
  const propertyName = getStaticPropertyName(node);

  if (objectName === null || propertyName === null) {
    return null;
  }

  const message = getRestrictedTestingMemberMessage(objectName, propertyName);
  if (message === null) {
    return null;
  }

  return {
    message,
    objectName,
    propertyName,
  };
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

const noRestrictedTestingMembersRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow restricted testing framework member access such as vi.fn, vi["fn"], and vi?.fn.',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const restrictedTestingMember = getRestrictedTestingMember(node);
        if (restrictedTestingMember === null || isTypeQueryMemberExpression(node)) {
          return;
        }

        context.report({
          node,
          message: restrictedTestingMember.message,
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
    "no-restricted-testing-members": noRestrictedTestingMembersRule,
  },
};

export default plugin;
