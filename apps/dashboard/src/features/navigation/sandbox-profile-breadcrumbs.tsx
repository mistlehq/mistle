import { useQuery } from "@tanstack/react-query";

import { sandboxProfileDetailQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import { AppBreadcrumbs } from "./app-breadcrumbs.js";

export type SandboxProfileBreadcrumbView = "published" | "draft" | "snapshots";

function resolveSandboxProfileDefaultPath(profileId: string): string {
  return `/sandbox-profiles/${profileId}/sandbox-profile`;
}

export function SandboxProfileBreadcrumbs(input: {
  profileId: string;
  view: SandboxProfileBreadcrumbView;
}): React.JSX.Element {
  const profileQuery = useQuery({
    queryKey: sandboxProfileDetailQueryKey(input.profileId),
    queryFn: async ({ signal }) =>
      getSandboxProfile({
        profileId: input.profileId,
        signal,
      }),
    retry: false,
  });
  const profileName = profileQuery.data?.displayName ?? "Profile";
  const profileDefaultPath = resolveSandboxProfileDefaultPath(input.profileId);
  const viewLabel =
    input.view === "draft" ? "Draft" : input.view === "published" ? "Published" : "Snapshots";

  return (
    <AppBreadcrumbs
      breadcrumbs={[
        {
          label: "Sandbox Profiles",
          to: "/sandbox-profiles",
          isCurrent: false,
        },
        {
          label: profileName,
          to: profileDefaultPath,
          isCurrent: false,
        },
        {
          label: viewLabel,
          to: null,
          isCurrent: true,
        },
      ]}
    />
  );
}
