const QualifiedTimerGlobalNames = new Set(["window", "globalThis"]);
const QualifiedTimerMethodNames = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
]);
const RestrictedTestApiMessages = new Map([
  ["vi.fn", "Do not use vi.fn mocks/stubs. Assert observable behavior instead."],
  ["vi.spyOn", "Do not use vi.spyOn. Assert observable behavior instead."],
  ["vi.mock", "Do not use vi.mock. Assert observable behavior instead."],
  ["vi.mocked", "Do not use vi.mocked. Assert observable behavior instead."],
  ["vi.stubGlobal", "Do not stub globals in tests. Assert observable behavior instead."],
  ["jest.fn", "Do not use jest.fn mocks/stubs. Assert observable behavior instead."],
  ["jest.spyOn", "Do not use jest.spyOn. Assert observable behavior instead."],
  ["jest.mock", "Do not use jest.mock. Assert observable behavior instead."],
  ["jest.mocked", "Do not use jest.mocked. Assert observable behavior instead."],
  ["sinon.stub", "Do not use sinon stubs. Assert observable behavior instead."],
  ["sinon.spy", "Do not use sinon spies. Assert observable behavior instead."],
  ["sinon.mock", "Do not use sinon mocks. Assert observable behavior instead."],
]);

function getRestrictedTimerMember(node) {
  const memberExpressionNames = getMemberExpressionNames(node);
  if (memberExpressionNames === null) {
    return null;
  }

  if (
    !QualifiedTimerGlobalNames.has(memberExpressionNames.objectName) ||
    !QualifiedTimerMethodNames.has(memberExpressionNames.propertyName)
  ) {
    return null;
  }

  return memberExpressionNames;
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

function getPropertyName(node) {
  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  return null;
}

function getMemberExpressionNames(node) {
  if (node.type !== "MemberExpression") {
    return null;
  }

  const objectName = getIdentifierName(node.object);
  const propertyName = getPropertyName(node.property);
  if (objectName === null || propertyName === null) {
    return null;
  }

  return { objectName, propertyName };
}

function getRestrictedTestApiMessage(node) {
  const memberExpressionNames = getMemberExpressionNames(node);
  if (memberExpressionNames === null) {
    return null;
  }

  return (
    RestrictedTestApiMessages.get(
      `${memberExpressionNames.objectName}.${memberExpressionNames.propertyName}`,
    ) ?? null
  );
}

const noQualifiedTimerGlobalsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow qualified timer globals such as window.setTimeout.",
    },
    messages: {
      restrictedTimerGlobal: "Use @mistle/time abstractions instead of {{qualifiedName}}.",
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
          data: {
            qualifiedName: `${restrictedTimerMember.objectName}.${restrictedTimerMember.propertyName}`,
          },
          messageId: "restrictedTimerGlobal",
          node,
        });
      },
    };
  },
};

const noRestrictedTestApiMembersRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow restricted test mocking APIs such as vi.fn and jest.spyOn.",
    },
    messages: {
      restrictedTestApi: "{{reason}}",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const message = getRestrictedTestApiMessage(node);
        if (message === null || isTypeQueryMemberExpression(node)) {
          return;
        }

        context.report({
          data: {
            reason: message,
          },
          messageId: "restrictedTestApi",
          node,
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
    "no-restricted-test-api-members": noRestrictedTestApiMembersRule,
  },
};

export default plugin;
