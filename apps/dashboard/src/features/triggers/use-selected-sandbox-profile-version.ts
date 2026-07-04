import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { sandboxProfileVersionsQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { listSandboxProfileVersions } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import { resolveTriggerTargetSandboxProfileVersion } from "./trigger-target-sandbox-profile-version.js";

export type SelectedSandboxProfileVersion = {
  profileId: string;
  version: number;
};

export function useSelectedSandboxProfileVersion(input: {
  selectedProfileId: string;
  initialSandboxProfileVersion?: number | undefined;
}): {
  effectiveSelectedProfileVersion: number | null;
  hasSelectableProfileVersion: boolean | null;
  isUsingPinnedSelectedProfileVersion: boolean;
  selectedProfileVersionsQuery: ReturnType<typeof useQuery<{ versions: SandboxProfileVersion[] }>>;
  setSelectedSandboxProfileVersion: (version: SelectedSandboxProfileVersion | null) => void;
} {
  const [selectedSandboxProfileVersion, setSelectedSandboxProfileVersion] =
    useState<SelectedSandboxProfileVersion | null>(
      input.initialSandboxProfileVersion === undefined || input.selectedProfileId.length === 0
        ? null
        : {
            profileId: input.selectedProfileId,
            version: input.initialSandboxProfileVersion,
          },
    );
  const isUsingPinnedSelectedProfileVersion =
    selectedSandboxProfileVersion?.profileId === input.selectedProfileId;
  const selectedProfileVersionsQuery = useQuery({
    queryKey: sandboxProfileVersionsQueryKey(input.selectedProfileId),
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId: input.selectedProfileId,
        signal,
      }),
    enabled: input.selectedProfileId.length > 0 && !isUsingPinnedSelectedProfileVersion,
    retry: false,
  });
  const selectableSelectedProfileVersion = useMemo(
    () =>
      resolveTriggerTargetSandboxProfileVersion(selectedProfileVersionsQuery.data?.versions ?? []),
    [selectedProfileVersionsQuery.data],
  );
  const effectiveSelectedProfileVersion = isUsingPinnedSelectedProfileVersion
    ? selectedSandboxProfileVersion.version
    : selectableSelectedProfileVersion;
  const hasSelectableProfileVersion =
    input.selectedProfileId.length === 0
      ? null
      : isUsingPinnedSelectedProfileVersion
        ? true
        : selectedProfileVersionsQuery.data === undefined
          ? null
          : selectableSelectedProfileVersion !== null;

  return {
    effectiveSelectedProfileVersion,
    hasSelectableProfileVersion,
    isUsingPinnedSelectedProfileVersion,
    selectedProfileVersionsQuery,
    setSelectedSandboxProfileVersion,
  };
}
