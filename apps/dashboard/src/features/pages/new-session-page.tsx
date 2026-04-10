import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
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
import type { LaunchableSandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import { useLaunchableSandboxProfiles } from "../sandbox-profiles/use-launchable-sandbox-profiles.js";
import { startSandboxInstanceFromProfileVersion } from "../sessions/sessions-service.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { FormPageFrame } from "../shared/page-frame.js";
import { shouldClearSelectedProfile } from "./sessions-page.js";

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

export function NewSessionPage(input?: { initialSelectedProfileId?: string }): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [profileQueryText, setProfileQueryText] = useState("");
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
    mutationFn: async (profile: LaunchableSandboxProfile) => {
      try {
        return await startSandboxInstanceFromProfileVersion({
          profileId: profile.id,
          profileVersion: profile.latestVersion,
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
  const showsRepositoryPicker = selectedProfile !== null;
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
      setProfileQueryText("");
      setSelectedProfileId(null);
      setSelectedRepositoryValue(null);
      setStartErrorMessage(null);
    }
  }, [selectableProfiles, selectableProfilesQuery.isPending, selectedProfile]);

  useEffect(() => {
    setProfileQueryText(selectedProfile?.displayName ?? "");
  }, [selectedProfile]);

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

    if (selectedProfile === null) {
      return;
    }

    setStartErrorMessage(null);
    startSessionMutation.mutate(selectedProfile);
  }

  return (
    <FormPageFrame title="Start new session">
      <div className="mx-auto my-auto w-full max-w-3xl">
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
            <FormPageStack>
              <FormPageSection>
                <div className="flex flex-col gap-4 p-4">
                  <Field contentWidth="fill" orientation="horizontal">
                    <FieldHeader>
                      <FieldLabel htmlFor="new-session-profile-combobox">
                        Sandbox profile
                      </FieldLabel>
                    </FieldHeader>
                    <FieldContent>
                      <Combobox<{ value: string; label: string }>
                        autoHighlight
                        disabled={
                          selectableProfilesQuery.isPending || startSessionMutation.isPending
                        }
                        inputValue={profileQueryText}
                        items={profileOptions}
                        isItemEqualToValue={(item, value) => item.value === value.value}
                        onInputValueChange={setProfileQueryText}
                        onOpenChange={(open) => {
                          if (!open) {
                            setProfileQueryText(selectedProfile?.displayName ?? "");
                          }
                        }}
                        onValueChange={(value) => {
                          setStartErrorMessage(null);
                          if (value === null) {
                            setProfileQueryText("");
                            setSelectedProfileId(null);
                            setSelectedRepositoryValue(null);
                            return;
                          }

                          setProfileQueryText(value.label);
                          setSelectedProfileId(value.value);
                          setSelectedRepositoryValue(null);
                        }}
                        value={selectedProfileOption}
                      >
                        <ComboboxInput
                          className="w-full"
                          disabled={
                            selectableProfilesQuery.isPending || startSessionMutation.isPending
                          }
                          id="new-session-profile-combobox"
                          placeholder="Select a sandbox profile"
                          showClear={false}
                        />
                        <ComboboxContent className="p-0">
                          <ComboboxList className="max-h-64">
                            {profileOptions.map((option) => (
                              <ComboboxItem key={option.value} value={option}>
                                <span className="truncate">{option.label}</span>
                              </ComboboxItem>
                            ))}
                            <ComboboxEmpty>No matching sandbox profiles.</ComboboxEmpty>
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </FieldContent>
                  </Field>

                  {showsRepositoryPicker ? (
                    <Field contentWidth="fill" orientation="horizontal">
                      <FieldHeader>
                        <FieldLabel htmlFor="new-session-repository-combobox">
                          Primary repository
                        </FieldLabel>
                      </FieldHeader>
                      <FieldContent>
                        <Combobox<NewSessionPageRepositoryOption>
                          autoHighlight
                          disabled={
                            selectableProfilesQuery.isPending || startSessionMutation.isPending
                          }
                          items={repositoryOptions}
                          isItemEqualToValue={(item, value) => item.value === value.value}
                          onValueChange={(value) => {
                            setStartErrorMessage(null);
                            setSelectedRepositoryValue(value?.value ?? null);
                          }}
                          value={selectedRepositoryOption}
                        >
                          <ComboboxInput
                            className="w-full"
                            disabled={
                              selectableProfilesQuery.isPending || startSessionMutation.isPending
                            }
                            id="new-session-repository-combobox"
                            placeholder="Select a repository"
                            showClear={false}
                          />
                          <ComboboxContent className="p-0">
                            <ComboboxList className="max-h-64">
                              {repositoryOptions.map((option) => (
                                <ComboboxItem key={option.value} value={option}>
                                  <span className="truncate">{option.label}</span>
                                </ComboboxItem>
                              ))}
                              <ComboboxEmpty>No matching repositories.</ComboboxEmpty>
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                      </FieldContent>
                    </Field>
                  ) : null}
                </div>
              </FormPageSection>

              {selectedLocationPath === null ? null : (
                <div className="text-muted-foreground flex flex-col gap-1 text-sm">
                  <p>
                    {selectedNoneOption ? (
                      "The agent will start its session at the workspace root."
                    ) : (
                      <>
                        The agent will start its session in{" "}
                        <span className="font-mono text-foreground">{selectedLocationPath}</span>.
                      </>
                    )}
                  </p>
                  <p>
                    {selectedNoneOption
                      ? "Git, diffs, and repo-local instructions will not be tied to a specific repository by default."
                      : "Git, diffs, and repo-local instructions will use this repository by default."}
                  </p>
                </div>
              )}

              {selectableProfilesQuery.isPending ? (
                <p className="text-muted-foreground text-sm">Loading sandbox profiles...</p>
              ) : null}
              {selectableProfilesErrorMessage ? (
                <FieldError errors={[{ message: selectableProfilesErrorMessage }]} />
              ) : null}

              <FormPageActionBar>
                <Button disabled={!canStartSession} size="lg" type="submit">
                  {startSessionMutation.isPending ? "Starting sandbox..." : "Start session"}
                </Button>
              </FormPageActionBar>
            </FormPageStack>
          </form>
        )}
      </div>
    </FormPageFrame>
  );
}
