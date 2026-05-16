import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { sandboxProfileVersionsQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { listSandboxProfileVersions } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";

export type SelectedSandboxProfileVersion = {
  profileId: string;
  version: number;
};

function resolveActiveVersion(versions: readonly SandboxProfileVersion[]): number | null {
  const activeVersion = versions.find((version) => version.isActive);
  return activeVersion?.version ?? null;
}

export function useSelectedSandboxProfileVersion(input: {
  selectedProfileId: string;
  initialSandboxProfileVersion?: number | undefined;
}): {
  effectiveSelectedProfileVersion: number | null;
  hasActiveProfileVersion: boolean | null;
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
  const activeSelectedProfileVersion = useMemo(
    () => resolveActiveVersion(selectedProfileVersionsQuery.data?.versions ?? []),
    [selectedProfileVersionsQuery.data],
  );
  const effectiveSelectedProfileVersion = isUsingPinnedSelectedProfileVersion
    ? selectedSandboxProfileVersion.version
    : activeSelectedProfileVersion;
  const hasActiveProfileVersion =
    input.selectedProfileId.length === 0
      ? null
      : isUsingPinnedSelectedProfileVersion
        ? true
        : selectedProfileVersionsQuery.data === undefined
          ? null
          : activeSelectedProfileVersion !== null;

  return {
    effectiveSelectedProfileVersion,
    hasActiveProfileVersion,
    isUsingPinnedSelectedProfileVersion,
    selectedProfileVersionsQuery,
    setSelectedSandboxProfileVersion,
  };
}
