export type CreatedTriggerNavigationTarget = {
  id: string;
  target: {
    sandboxProfileId: string;
  };
};

export type TriggerCreateSuccessPath = (trigger: CreatedTriggerNavigationTarget) => string;

export function createProfileTriggersPath(profileId: string): string {
  return `/sandbox-profiles/${profileId}/triggers`;
}

export function createProfileTriggerDetailPath(input: {
  profileId: string;
  triggerId: string;
  searchParams?: URLSearchParams;
}): string {
  const search = input.searchParams?.toString();
  const suffix = search === undefined || search.length === 0 ? "" : `?${search}`;

  return `${createProfileTriggersPath(input.profileId)}/${input.triggerId}${suffix}`;
}
