export type ApiKeyPermissionOption = {
  value: string;
  label: string;
  description: string;
};

export type AllowedMistleResourceGroup = {
  actions: readonly string[];
  label: string;
};

export type AllowedMistleResourceAccessSummary = {
  resourceGroups: readonly AllowedMistleResourceGroup[];
  ungroupedPermissions: readonly string[];
};

export const ApiKeyPermissionOptions: readonly ApiKeyPermissionOption[] = [
  {
    value: "sandboxProfile:read",
    label: "Read sandbox profiles",
    description: "View sandbox profile configuration.",
  },
  {
    value: "sandboxProfile:create",
    label: "Create sandbox profiles",
    description: "Create new sandbox profiles.",
  },
  {
    value: "sandboxProfile:update",
    label: "Update sandbox profiles",
    description: "Edit sandbox profile configuration.",
  },
  {
    value: "sandboxProfile:delete",
    label: "Delete sandbox profiles",
    description: "Delete sandbox profiles.",
  },
  {
    value: "sandboxSession:create",
    label: "Create sessions",
    description: "Start sandbox sessions.",
  },
  {
    value: "sandboxSession:read",
    label: "Read sessions",
    description: "View sandbox sessions.",
  },
  {
    value: "sandboxSession:resume",
    label: "Resume sessions",
    description: "Resume stopped sandbox sessions.",
  },
  {
    value: "sandboxSession:connect",
    label: "Connect to sessions",
    description: "Open session connections and terminals.",
  },
  {
    value: "trigger:read",
    label: "Read triggers",
    description: "View triggers.",
  },
  {
    value: "trigger:create",
    label: "Create triggers",
    description: "Create triggers.",
  },
  {
    value: "trigger:update",
    label: "Update triggers",
    description: "Edit triggers.",
  },
  {
    value: "trigger:delete",
    label: "Delete triggers",
    description: "Delete triggers.",
  },
];

export const DefaultApiKeyPermissions: readonly string[] = [
  "sandboxProfile:read",
  "sandboxSession:create",
  "sandboxSession:read",
  "sandboxSession:connect",
];

const MistleResourcePermissionGroups = [
  {
    label: "Sandbox profiles",
    permissions: [
      "sandboxProfile:read",
      "sandboxProfile:create",
      "sandboxProfile:update",
      "sandboxProfile:delete",
    ],
  },
  {
    label: "Sessions",
    permissions: [
      "sandboxSession:create",
      "sandboxSession:read",
      "sandboxSession:resume",
      "sandboxSession:connect",
    ],
  },
  {
    label: "Triggers",
    permissions: [
      "trigger:read",
      "trigger:create",
      "trigger:update",
      "trigger:delete",
      "triggerWebhook:read",
      "triggerWebhook:create",
      "triggerWebhook:update",
      "triggerWebhook:delete",
    ],
  },
] as const;

const ApiKeyPermissionOptionByValue = new Map(
  [
    ...ApiKeyPermissionOptions,
    {
      value: "triggerWebhook:read",
      label: "Read triggers",
      description: "View triggers.",
    },
    {
      value: "triggerWebhook:create",
      label: "Create triggers",
      description: "Create triggers.",
    },
    {
      value: "triggerWebhook:update",
      label: "Update triggers",
      description: "Edit triggers.",
    },
    {
      value: "triggerWebhook:delete",
      label: "Delete triggers",
      description: "Delete triggers.",
    },
  ].map((option) => [option.value, option]),
);

export function createAllowedMistleResourceAccessSummary(
  permissions: readonly string[],
): AllowedMistleResourceAccessSummary {
  const selectedPermissionValues = new Set(permissions);
  const groupedPermissionValues = new Set<string>();

  const resourceGroups = MistleResourcePermissionGroups.map((group) => {
    const actions = new Set<string>();

    for (const permission of group.permissions) {
      groupedPermissionValues.add(permission);

      if (selectedPermissionValues.has(permission)) {
        actions.add(formatApiKeyPermission(permission));
      }
    }

    return {
      label: group.label,
      actions: [...actions],
    };
  }).filter((group) => group.actions.length > 0);

  const ungroupedPermissions = [...selectedPermissionValues]
    .filter((permission) => !groupedPermissionValues.has(permission))
    .map(formatApiKeyPermission);

  return {
    resourceGroups,
    ungroupedPermissions,
  };
}

function formatApiKeyPermission(permission: string): string {
  return ApiKeyPermissionOptionByValue.get(permission)?.label ?? permission;
}
