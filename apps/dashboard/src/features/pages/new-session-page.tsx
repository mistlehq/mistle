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
import { shouldClearSelectedProfile } from "./sessions-page.js";

export function NewSessionPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [profileQueryText, setProfileQueryText] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
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
  const selectedProfileOption =
    selectedProfileId === null
      ? null
      : (profileOptions.find((option) => option.value === selectedProfileId) ?? null);
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
      setStartErrorMessage(null);
    }
  }, [selectableProfiles, selectableProfilesQuery.isPending, selectedProfile]);

  useEffect(() => {
    setProfileQueryText(selectedProfile?.displayName ?? "");
  }, [selectedProfile]);

  function handleCreateSessionSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (selectedProfile === null) {
      return;
    }

    setStartErrorMessage(null);
    startSessionMutation.mutate(selectedProfile);
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-6">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Start new session</h1>
        </div>

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
          <form className="flex flex-col gap-4" onSubmit={handleCreateSessionSubmit}>
            <Field>
              <FieldLabel className="sr-only" htmlFor="new-session-profile-combobox">
                Sandbox profile
              </FieldLabel>
              <FieldContent>
                <Combobox<{ value: string; label: string }>
                  autoHighlight
                  disabled={selectableProfilesQuery.isPending || startSessionMutation.isPending}
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
                      return;
                    }

                    setProfileQueryText(value.label);
                    setSelectedProfileId(value.value);
                  }}
                  value={selectedProfileOption}
                >
                  <ComboboxInput
                    className="w-full"
                    disabled={selectableProfilesQuery.isPending || startSessionMutation.isPending}
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

            {selectableProfilesQuery.isPending ? (
              <p className="text-muted-foreground text-center text-sm">
                Loading sandbox profiles...
              </p>
            ) : null}
            {selectableProfilesErrorMessage ? (
              <FieldError errors={[{ message: selectableProfilesErrorMessage }]} />
            ) : null}

            <div className="flex justify-center">
              <Button disabled={!canStartSession} size="lg" type="submit">
                {startSessionMutation.isPending ? "Starting sandbox..." : "Start"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
