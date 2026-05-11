export type CreatedAutomationNavigationTarget = {
  id: string;
  target: {
    sandboxProfileId: string;
  };
};

export type AutomationCreateSuccessPath = (automation: CreatedAutomationNavigationTarget) => string;

export function createProfileAutomationsPath(profileId: string): string {
  return `/sandbox-profiles/${profileId}/automations`;
}

export function createProfileAutomationDetailPath(input: {
  profileId: string;
  automationId: string;
  searchParams?: URLSearchParams;
}): string {
  const search = input.searchParams?.toString();
  const suffix = search === undefined || search.length === 0 ? "" : `?${search}`;

  return `${createProfileAutomationsPath(input.profileId)}/${input.automationId}${suffix}`;
}
