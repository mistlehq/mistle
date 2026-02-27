function createList<const TItem extends string>(...items: readonly TItem[]): readonly TItem[] {
  return items;
}

const capabilities = createList(
  "auth-otp",
  "members-directory",
  "members-invite-email",
  "sandbox-profiles-crud",
  "sandbox-profile-delete-async",
);

const components = createList(
  "postgres-stack",
  "mailpit",
  "workflow-backend",
  "control-plane-api-runtime",
  "control-plane-worker-runtime",
);

type IntegrationCapability = (typeof capabilities)[number];
type IntegrationComponent = (typeof components)[number];

const capabilityComponentMap: Readonly<
  Record<IntegrationCapability, readonly IntegrationComponent[]>
> = {
  "members-directory": ["postgres-stack", "workflow-backend", "control-plane-api-runtime"],
  "sandbox-profiles-crud": ["postgres-stack", "workflow-backend", "control-plane-api-runtime"],
  "auth-otp": [
    "postgres-stack",
    "mailpit",
    "workflow-backend",
    "control-plane-api-runtime",
    "control-plane-worker-runtime",
  ],
  "members-invite-email": [
    "postgres-stack",
    "mailpit",
    "workflow-backend",
    "control-plane-api-runtime",
    "control-plane-worker-runtime",
  ],
  "sandbox-profile-delete-async": [
    "postgres-stack",
    "workflow-backend",
    "control-plane-api-runtime",
    "control-plane-worker-runtime",
  ],
};

export const IntegrationCatalog = {
  capabilities,
  components,
  capabilityComponentMap,
} as const;
