export type ApiKeyPermissionOption = {
  value: string;
  label: string;
  description: string;
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
    value: "triggerWebhook:read",
    label: "Read triggers",
    description: "View webhook triggers.",
  },
  {
    value: "triggerWebhook:create",
    label: "Create triggers",
    description: "Create webhook triggers.",
  },
  {
    value: "triggerWebhook:update",
    label: "Update triggers",
    description: "Edit webhook triggers.",
  },
  {
    value: "triggerWebhook:delete",
    label: "Delete triggers",
    description: "Delete webhook triggers.",
  },
];

export const DefaultApiKeyPermissions: readonly string[] = [
  "sandboxProfile:read",
  "sandboxSession:create",
  "sandboxSession:read",
  "sandboxSession:connect",
];
