const ControlPlaneStaticTableNames = new Set([
  "accounts",
  "automationConversationDeliveryProcessors",
  "automationConversationDeliveryTasks",
  "automationConversationRoutes",
  "automationConversations",
  "automationRuns",
  "automationTargets",
  "automations",
  "identityLinkRedirectSessions",
  "integrationConnectionCredentials",
  "integrationConnectionDeviceAuthorizationAttempts",
  "integrationConnectionRedirectSessions",
  "integrationConnectionResourceStates",
  "integrationConnectionResources",
  "integrationConnections",
  "integrationCredentials",
  "integrationTargets",
  "integrationWebhookEvents",
  "integrationWebhookSources",
  "invitations",
  "members",
  "organizationCredentialKeys",
  "organizationIdentityLinkProviderConfigs",
  "organizationSandboxStorageSettings",
  "organizations",
  "sandboxProfileSnapshotRefreshScheduleTargets",
  "sandboxProfileVersionIntegrationBindings",
  "sandboxProfileVersionSnapshotJobs",
  "sandboxProfileVersions",
  "sandboxProfiles",
  "scheduleAutomations",
  "scheduledActions",
  "schedules",
  "sessions",
  "teamMembers",
  "teams",
  "userExternalPrincipalCredentialSecrets",
  "userExternalPrincipalCredentials",
  "userExternalPrincipalKeys",
  "userExternalPrincipals",
  "users",
  "verifications",
  "webhookAutomations",
]);
const DataPlaneStaticTableNames = new Set([
  "sandboxInstanceDeadlines",
  "sandboxInstanceRuntimePlans",
  "sandboxInstanceStorages",
  "sandboxInstances",
  "sandboxTunnelTokenRedemptions",
]);
const StaticTableNamesByDbModule = new Map([
  ["@mistle/db/control-plane", ControlPlaneStaticTableNames],
  ["@mistle/db/data-plane", DataPlaneStaticTableNames],
]);
const StaticTableDirectQueryMethodNames = new Set([
  "delete",
  "from",
  "fullJoin",
  "innerJoin",
  "insert",
  "join",
  "leftJoin",
  "rightJoin",
  "update",
]);
const StaticTablePredicateMethodNames = new Set([
  "eq",
  "gt",
  "gte",
  "inArray",
  "isNotNull",
  "isNull",
  "lt",
  "lte",
  "ne",
  "notInArray",
]);
const RuntimeStaticTableRestrictedPathPrefixes = [
  "apps/control-plane-api/src/",
  "apps/control-plane-worker/openworkflow/",
  "apps/data-plane-api/src/",
  "apps/data-plane-worker/openworkflow/",
  "apps/data-plane-gateway/src/",
  "apps/tokenizer-proxy/src/",
];
const TestLikePathPattern =
  /(?:^|\/)(?:integration|integration-new|e2e|tests?)\/|\.(?:test|integration|component|property|stress)\.tsx?$/u;

function getIdentifierName(node) {
  if (node === undefined || node === null || node.type !== "Identifier") {
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

function getImportSpecifierImportedName(specifier) {
  if (specifier.type !== "ImportSpecifier") {
    return null;
  }

  return getIdentifierName(specifier.imported);
}

function getImportSpecifierLocalName(specifier) {
  if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") {
    return null;
  }

  return getIdentifierName(specifier.local);
}

function getImportSourceName(node) {
  if (node.type !== "ImportDeclaration" || node.importKind === "type") {
    return null;
  }

  return typeof node.source.value === "string" ? node.source.value : null;
}

function getCallExpressionCalleeName(node) {
  if (node.type !== "CallExpression") {
    return null;
  }

  if (node.callee.type === "Identifier") {
    return node.callee.name;
  }

  if (node.callee.type === "MemberExpression") {
    return getPropertyName(node.callee.property);
  }

  return null;
}

function getStaticTableMemberObjectName(node) {
  if (node.type !== "MemberExpression") {
    return null;
  }

  return getIdentifierName(node.object);
}

function normalizeFilename(filename) {
  const normalized = filename.replaceAll("\\", "/");
  for (const marker of ["/apps/", "/packages/", "/tests/"]) {
    const index = normalized.indexOf(marker);
    if (index !== -1) {
      return normalized.slice(index + 1);
    }
  }

  if (normalized.startsWith("apps/") || normalized.startsWith("packages/")) {
    return normalized;
  }

  const cwd = process.cwd().replaceAll("\\", "/");
  for (const marker of ["/apps/", "/packages/"]) {
    const index = cwd.indexOf(marker);
    if (index !== -1) {
      return `${cwd.slice(index + 1)}/${normalized}`;
    }
  }

  return normalized;
}

function getContextFilename(context) {
  if (typeof context.getFilename === "function") {
    return normalizeFilename(context.getFilename());
  }

  if (typeof context.filename === "string") {
    return normalizeFilename(context.filename);
  }

  if (typeof context.physicalFilename === "string") {
    return normalizeFilename(context.physicalFilename);
  }

  return "unknown";
}

function isRuntimeStaticTableRestrictedPath(filename) {
  if (TestLikePathPattern.test(filename)) {
    return false;
  }

  return RuntimeStaticTableRestrictedPathPrefixes.some((prefix) => filename.startsWith(prefix));
}

const noStaticDbTablesInRuntimeRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow static Drizzle table objects in runtime app query builders.",
    },
    messages: {
      staticDbTable:
        "Use request/environment-bound schema tables instead of static table '{{tableName}}'. Resolve tables with getControlPlaneDatabaseSchema(db), getDataPlaneDatabaseSchema(db), or pass the bound tables through the call path.",
    },
    schema: [],
  },
  create(context) {
    const filename = getContextFilename(context);
    if (!isRuntimeStaticTableRestrictedPath(filename)) {
      return {};
    }

    const staticTableImportsByLocalName = new Map();

    function reportStaticTableUse(node, localTableName) {
      const importedTableName = staticTableImportsByLocalName.get(localTableName);
      if (importedTableName === undefined) {
        return;
      }

      context.report({
        data: {
          tableName: importedTableName,
        },
        messageId: "staticDbTable",
        node,
      });
    }

    return {
      ImportDeclaration(node) {
        const importSourceName = getImportSourceName(node);
        if (importSourceName === null) {
          return;
        }

        const staticTableNames = StaticTableNamesByDbModule.get(importSourceName);
        if (staticTableNames === undefined) {
          return;
        }

        for (const specifier of node.specifiers) {
          const importedName = getImportSpecifierImportedName(specifier);
          const localName = getImportSpecifierLocalName(specifier);
          if (importedName === null || localName === null || !staticTableNames.has(importedName)) {
            continue;
          }

          staticTableImportsByLocalName.set(localName, importedName);
        }
      },
      CallExpression(node) {
        const calleeName = getCallExpressionCalleeName(node);
        if (calleeName === null) {
          return;
        }

        if (StaticTableDirectQueryMethodNames.has(calleeName)) {
          const firstArgument = node.arguments[0];
          const localTableName = getIdentifierName(firstArgument);
          if (localTableName !== null) {
            reportStaticTableUse(firstArgument, localTableName);
          }
        }

        if (StaticTablePredicateMethodNames.has(calleeName)) {
          for (const argument of node.arguments) {
            const localTableName = getStaticTableMemberObjectName(argument);
            if (localTableName !== null) {
              reportStaticTableUse(argument, localTableName);
            }
          }
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: "mistle-db",
  },
  rules: {
    "no-static-db-tables-in-runtime": noStaticDbTablesInRuntimeRule,
  },
};

export default plugin;
