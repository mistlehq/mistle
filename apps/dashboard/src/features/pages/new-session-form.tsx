import {
  Button,
  Field,
  FieldContent,
  FieldError,
  FieldHeader,
  FieldLabel,
  Notice,
} from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SyntheticEvent } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import type { LaunchableSandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import { useLaunchableSandboxProfiles } from "../sandbox-profiles/use-launchable-sandbox-profiles.js";
import { startSandboxInstanceFromProfileVersion } from "../sessions/sessions-service.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

type NewSessionPageRepositoryOption = {
  value: string;
  label: string;
  path: string;
};

const WorkspaceRootDescription = "workspace root";

const WorkspaceRootOption: NewSessionPageRepositoryOption = {
  value: "__workspace_root__",
  label: "None",
  path: WorkspaceRootDescription,
};

export function shouldClearSelectedProfile(input: {
  selectedProfile: LaunchableSandboxProfile | null;
  selectableProfiles: readonly LaunchableSandboxProfile[];
  isSelectableProfilesPending: boolean;
}): boolean {
  if (input.selectedProfile === null || input.isSelectableProfilesPending) {
    return false;
  }

  const selectedProfileId = input.selectedProfile.id;

  return !input.selectableProfiles.some((profile) => profile.id === selectedProfileId);
}

export function NewSessionForm(input?: { initialSelectedProfileId?: string }): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    input?.initialSelectedProfileId ?? null,
  );
  const [selectedRepositoryValue, setSelectedRepositoryValue] = useState<string | null>(null);
  const [startErrorMessage, setStartErrorMessage] = useState<string | null>(null);
  const selectableProfilesQuery = useLaunchableSandboxProfiles();
  const selectableProfiles = selectableProfilesQuery.data?.items ?? [];
  const profileOptions = selectableProfiles.map((profile) => ({
    value: profile.id,
    label: profile.displayName,
  }));
  const selectedProfile =
    selectedProfileId === null
      ? null
      : (selectableProfiles.find((profile) => profile.id === selectedProfileId) ?? null);
  const selectedProfileVersion = selectedProfile?.activeVersion ?? null;
  const repositoryOptionsForProfile =
    selectedProfile?.repositoryOptions.map((option) => ({
      value: option.id,
      label: option.label,
      path: option.path,
    })) ?? [];
  const repositoryOptions =
    selectedProfile === null
      ? []
      : repositoryOptionsForProfile.length === 0
        ? [WorkspaceRootOption]
        : [WorkspaceRootOption, ...repositoryOptionsForProfile];
  const selectedProfileOption =
    selectedProfileId === null
      ? null
      : (profileOptions.find((option) => option.value === selectedProfileId) ?? null);
  const selectedRepositoryOption =
    selectedRepositoryValue === null
      ? null
      : (repositoryOptions.find((option) => option.value === selectedRepositoryValue) ?? null);
  const startSessionMutation = useMutation({
    mutationFn: async (input: {
      profile: LaunchableSandboxProfile;
      profileVersion: number;
      primaryRepositoryId: string | null;
    }) => {
      try {
        return await startSandboxInstanceFromProfileVersion({
          profileId: input.profile.id,
          profileVersion: input.profileVersion,
          primaryRepositoryId: input.primaryRepositoryId,
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        if (error instanceof Error && error.message.trim().length > 0) {
          throw new Error(`Starting sandbox instance failed: ${error.message}`);
        }

        throw new Error("Starting sandbox instance failed.");
      }
    },
    onSuccess: async (result) => {
      setStartErrorMessage(null);
      await queryClient.invalidateQueries({
        queryKey: ["sandbox-instances", "list"],
      });
      await navigate(`/sessions/${encodeURIComponent(result.sandboxInstanceId)}`);
    },
    onError: (error) => {
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not start sandbox session.",
      );
    },
  });
  const canStartSession =
    selectedProfile !== null &&
    selectedProfileVersion !== null &&
    selectedRepositoryOption !== null &&
    !selectableProfilesQuery.isPending &&
    !startSessionMutation.isPending;
  const selectableProfilesErrorMessage = selectableProfilesQuery.isError
    ? resolveApiErrorMessage({
        error: selectableProfilesQuery.error,
        fallbackMessage: "Could not load sandbox profiles.",
      })
    : null;
  const hasNoLaunchableProfiles =
    !selectableProfilesQuery.isPending &&
    !selectableProfilesQuery.isError &&
    selectableProfiles.length === 0;
  const selectedLocationPath = selectedRepositoryOption?.path ?? null;
  const selectedNoneOption = selectedRepositoryOption?.value === WorkspaceRootOption.value;

  useEffect(() => {
    if (
      shouldClearSelectedProfile({
        selectedProfile,
        selectableProfiles,
        isSelectableProfilesPending: selectableProfilesQuery.isPending,
      })
    ) {
      setSelectedProfileId(null);
      setSelectedRepositoryValue(null);
      setStartErrorMessage(null);
    }
  }, [selectableProfiles, selectableProfilesQuery.isPending, selectedProfile]);

  useEffect(() => {
    if (repositoryOptions.length === 0) {
      if (selectedRepositoryValue !== null) {
        setSelectedRepositoryValue(null);
      }
      return;
    }

    const matchingRepository = repositoryOptions.find(
      (option) => option.value === selectedRepositoryValue,
    );
    if (matchingRepository !== undefined) {
      return;
    }

    const firstRepositoryOption =
      repositoryOptions.find((option) => option.value !== WorkspaceRootOption.value) ??
      repositoryOptions[0];
    if (firstRepositoryOption !== undefined) {
      setSelectedRepositoryValue(firstRepositoryOption.value);
    }
  }, [repositoryOptions, selectedRepositoryValue]);

  function handleCreateSessionSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (
      selectedProfile === null ||
      selectedProfileVersion === null ||
      selectedRepositoryOption === null
    ) {
      return;
    }

    setStartErrorMessage(null);
    startSessionMutation.mutate({
      profile: selectedProfile,
      profileVersion: selectedProfileVersion,
      primaryRepositoryId:
        selectedRepositoryOption.value === WorkspaceRootOption.value
          ? null
          : selectedRepositoryOption.value,
    });
  }

  return (
    <div className="w-full">
      {startErrorMessage ? (
        <Notice title="Session start failed" variant="alert">
          {startErrorMessage}
        </Notice>
      ) : null}
      {hasNoLaunchableProfiles ? (
        <Notice
          className="[&_[data-slot=notice-content]]:items-center [&_[data-slot=notice-main]]:justify-center [&_[data-slot=notice-title]]:text-center"
          title="No launchable sandbox profiles are available yet."
        />
      ) : null}

      {hasNoLaunchableProfiles ? null : (
        <form onSubmit={handleCreateSessionSubmit}>
          <FormPageStack className="gap-3">
            <FormPageSection>
              <div className="flex flex-col gap-4 p-4">
                <Field contentWidth="fill" orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="new-session-profile-combobox">Sandbox profile</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <SingleSelectStringComboboxField
                      disabled={selectableProfilesQuery.isPending || startSessionMutation.isPending}
                      emptyMessage="No matching sandbox profiles."
                      inputId="new-session-profile-combobox"
                      inputLabel="Sandbox profile"
                      onChange={(value) => {
                        setStartErrorMessage(null);
                        setSelectedProfileId(value ?? null);
                        setSelectedRepositoryValue(null);
                      }}
                      options={profileOptions}
                      placeholder="Select a sandbox profile"
                      showClear={false}
                      value={selectedProfileOption?.value}
                    />
                  </FieldContent>
                </Field>

                <Field contentWidth="fill" orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="new-session-repository-combobox">
                      Primary repository
                    </FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <SingleSelectStringComboboxField
                      disabled={
                        selectedProfile === null ||
                        selectableProfilesQuery.isPending ||
                        startSessionMutation.isPending
                      }
                      emptyMessage="No matching repositories."
                      inputId="new-session-repository-combobox"
                      inputLabel="Primary repository"
                      onChange={(value) => {
                        setStartErrorMessage(null);
                        setSelectedRepositoryValue(value ?? null);
                      }}
                      options={repositoryOptions}
                      placeholder={
                        selectedProfile === null
                          ? "Select a sandbox profile first"
                          : "Select a repository"
                      }
                      showClear={false}
                      value={selectedRepositoryOption?.value}
                    />
                  </FieldContent>
                </Field>
              </div>
            </FormPageSection>

            {selectableProfilesErrorMessage ? (
              <FieldError errors={[{ message: selectableProfilesErrorMessage }]} />
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="text-muted-foreground min-w-0 text-sm sm:min-h-11 sm:flex-1">
                {selectedLocationPath === null ? null : (
                  <div className="flex flex-col gap-1">
                    <p className="sm:truncate">
                      {selectedNoneOption ? (
                        "The agent will start its session at the workspace root."
                      ) : (
                        <>
                          The agent will start its session in{" "}
                          <span className="break-all font-mono text-foreground sm:break-normal">
                            {selectedLocationPath}
                          </span>
                          {"."}
                        </>
                      )}
                    </p>
                    <p className="sm:truncate">
                      {selectedNoneOption
                        ? "Git, diffs, and repo-local instructions will not be tied to a specific repository by default."
                        : "Git, diffs, and repo-local instructions will use this repository by default."}
                    </p>
                  </div>
                )}
              </div>
              <Button
                className="w-full sm:w-auto"
                disabled={!canStartSession}
                size="lg"
                type="submit"
              >
                {startSessionMutation.isPending ? "Starting sandbox..." : "Start session"}
              </Button>
            </div>
          </FormPageStack>
        </form>
      )}
    </div>
  );
}
