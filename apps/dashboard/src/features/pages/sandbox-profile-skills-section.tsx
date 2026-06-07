import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  OverflowTooltipText,
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@mistle/ui";
import { ArrowClockwiseIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { sandboxProfileVersionSkillsSourceReposQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  listSandboxProfileVersionSkillsSourceRepos,
  refreshSandboxProfileVersionSkillsSourceRepo,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxProfileVersion,
  SandboxProfileVersionSkillsSourceRepo,
  SandboxProfileVersionSkillsSourceReposResult,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { ScriptEditorLineHeight, ScriptEditorMaxHeight } from "./sandbox-setup-script-editor.js";

type SandboxProfileSkillsConfig = SandboxProfileVersion["skillsConfig"];
type SelectedSkill = NonNullable<SandboxProfileSkillsConfig>["selectedSkills"][number];

export type SandboxProfileSkillsDraftState = {
  skillsConfig: SandboxProfileSkillsConfig | undefined;
  sourceVersionKey: string | undefined;
  saveBlockedMessage: string | null;
  hasUnpersistedChanges: boolean;
  applyDraftValidationError?: (message: string) => void;
  applyDraftSaveError?: (error: unknown) => void;
  applySavedSkillsConfig?: (skillsConfig: SandboxProfileSkillsConfig) => void;
  buildDraftChanges?: () => SandboxProfileSkillsConfig;
};

type SkillsSourceRepositoryOption = {
  label: string;
  originUrl: string;
};

type SkillOption = SelectedSkill & {
  description: string;
  available: boolean;
};

const NoSkillsSourceValue = "__no_skills_source__";
const AddPublicGitHubSourceValue = "__add_public_github_source__";
const UnavailableSkillsSourceSaveBlockedMessage =
  "Choose an available skills source, or clear the skills source before saving.";
const SkillsListMinHeight = "calc(var(--spacing) * 28)";
const SkillsListHeightStyle = {
  lineHeight: ScriptEditorLineHeight,
  maxHeight: ScriptEditorMaxHeight,
  minHeight: SkillsListMinHeight,
  overflowY: "auto",
} satisfies CSSProperties;

export function createSkillsDraftSourceVersionKey(
  version: Pick<SandboxProfileVersion, "sandboxProfileId" | "version">,
): string {
  return `${version.sandboxProfileId}:${String(version.version)}`;
}

export function resolveSkillsConfigSaveBlockedMessage(input: {
  skillsConfig: SandboxProfileSkillsConfig;
  sourceOptions: readonly { originUrl: string }[];
}): string | null {
  const selectedOriginUrl = input.skillsConfig?.originUrl ?? null;
  if (selectedOriginUrl === null) {
    return null;
  }

  const sourceIsAvailable = input.sourceOptions.some(
    (sourceOption) => sourceOption.originUrl === selectedOriginUrl,
  );
  return sourceIsAvailable ? null : UnavailableSkillsSourceSaveBlockedMessage;
}

export function SandboxProfileSkillsSection(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  automaticLoadingEnabled?: boolean;
  integrationRows: readonly SandboxProfileBindingEditorRow[];
  integrationRowsHaveUnpersistedChanges: boolean;
  isDraft: boolean;
  onSaveDraftBeforeSkillsReload?: () => Promise<boolean>;
  onDraftStateChange?: (state: SandboxProfileSkillsDraftState) => void;
  profileId: string;
  readOnly: boolean;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const persistedConfig = input.version.skillsConfig;
  const sourceOptions = useMemo(
    () =>
      resolveSkillsSourceRepositoryOptions({
        availableConnections: input.availableConnections,
        availableTargets: input.availableTargets,
        integrationRows: input.integrationRows,
      }),
    [input.availableConnections, input.availableTargets, input.integrationRows],
  );
  const [draftConfig, setDraftConfig] = useState<SandboxProfileSkillsConfig>(persistedConfig);
  const [persistedDraftConfig, setPersistedDraftConfig] =
    useState<SandboxProfileSkillsConfig>(persistedConfig);
  const [skillsSearchQuery, setSkillsSearchQuery] = useState("");
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [saveAndReloadDialogIsOpen, setSaveAndReloadDialogIsOpen] = useState(false);
  const [saveAndReloadIsPending, setSaveAndReloadIsPending] = useState(false);
  const [publicSourceDialogIsOpen, setPublicSourceDialogIsOpen] = useState(false);
  const [publicSourceUrl, setPublicSourceUrl] = useState("");
  const [publicSourceErrorMessage, setPublicSourceErrorMessage] = useState<string | null>(null);
  const attemptedAutoLoadKeysRef = useRef(new Set<string>());
  const draftConfigRef = useRef(draftConfig);
  draftConfigRef.current = draftConfig;

  const selectedOriginUrl = draftConfig?.originUrl ?? null;
  const selectedPublicSourceOption =
    selectedOriginUrl === null ||
    sourceOptions.some((sourceOption) => sourceOption.originUrl === selectedOriginUrl)
      ? null
      : createPublicGitHubSkillsSourceOption(selectedOriginUrl);
  const selectableSourceOptions =
    selectedPublicSourceOption === null
      ? sourceOptions
      : [
          ...sourceOptions.filter(
            (sourceOption) => sourceOption.originUrl !== selectedPublicSourceOption.originUrl,
          ),
          selectedPublicSourceOption,
        ].sort(compareSkillsSourceRepositoryOptions);
  const selectedSourceOption =
    selectedOriginUrl === null
      ? null
      : (selectableSourceOptions.find(
          (sourceOption) => sourceOption.originUrl === selectedOriginUrl,
        ) ?? null);
  const saveBlockedMessage = resolveSkillsConfigSaveBlockedMessage({
    skillsConfig: draftConfig,
    sourceOptions: selectableSourceOptions,
  });
  const sourceIsUnavailable = saveBlockedMessage !== null;
  const skillsSourceQuery = useQuery({
    queryKey: sandboxProfileVersionSkillsSourceReposQueryKey({
      profileId: input.profileId,
      version: input.version.version,
      originUrl: selectedOriginUrl,
    }),
    queryFn: async ({ signal }) => {
      if (selectedOriginUrl === null) {
        throw new Error("Skills source originUrl is required.");
      }

      return listSandboxProfileVersionSkillsSourceRepos({
        profileId: input.profileId,
        version: input.version.version,
        originUrl: selectedOriginUrl,
        signal,
      });
    },
    enabled: selectedOriginUrl !== null,
    retry: false,
  });
  const refreshMutation = useMutation({
    mutationFn: async (originUrl: string) =>
      refreshSandboxProfileVersionSkillsSourceRepo({
        profileId: input.profileId,
        version: input.version.version,
        originUrl,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      setSaveErrorMessage(null);
      queryClient.setQueryData<SandboxProfileVersionSkillsSourceReposResult>(
        sandboxProfileVersionSkillsSourceReposQueryKey({
          profileId: input.profileId,
          version: input.version.version,
          originUrl: result.skillsSourceRepo.originUrl,
        }),
        {
          items: [result.skillsSourceRepo],
        },
      );
    },
    onError: (error: unknown) => {
      setSaveErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not refresh skills.",
        }),
      );
    },
  });

  const skillsSourceRepo =
    selectedOriginUrl === null
      ? null
      : (skillsSourceQuery.data?.items.find((item) => item.originUrl === selectedOriginUrl) ??
        null);
  const selectedSkills = draftConfig?.selectedSkills ?? [];
  const skillOptions = createSkillOptions({
    selectedSkills,
    skillsSourceRepo,
  });
  const selectedSkillIdentities = new Set(selectedSkills.map(createSelectedSkillIdentity));
  const selectedSkillOptions =
    skillsSourceRepo === null
      ? selectedSkills.map(createSelectedSkillOption)
      : skillOptions.filter(
          (skill) =>
            !skill.available || selectedSkillIdentities.has(createSelectedSkillIdentity(skill)),
        );
  const availableSkillOptions = skillOptions.filter((skill) => skill.available);
  const visibleAvailableSkillOptions = availableSkillOptions.filter((skill) =>
    skillMatchesSearchQuery(skill, skillsSearchQuery),
  );
  const unavailableSelectedSkills =
    skillsSourceRepo === null ? [] : skillOptions.filter((skill) => !skill.available);
  const allVisibleDiscoveredSkillsSelected =
    visibleAvailableSkillOptions.length > 0 &&
    visibleAvailableSkillOptions.every((skill) =>
      selectedSkillIdentities.has(createSelectedSkillIdentity(skill)),
    );
  const someVisibleDiscoveredSkillsSelected =
    !allVisibleDiscoveredSkillsSelected &&
    visibleAvailableSkillOptions.some((skill) =>
      selectedSkillIdentities.has(createSelectedSkillIdentity(skill)),
    );
  const fieldIsReadOnly = input.disabled || input.readOnly || !input.isDraft;
  const shouldShowEditableSkillCatalog = !fieldIsReadOnly && skillsSourceRepo !== null;
  const automaticLoadingIsEnabled = input.automaticLoadingEnabled !== false;
  const queryLoadIsPending = selectedOriginUrl !== null && skillsSourceQuery.isPending;
  const loadIsPending = queryLoadIsPending || refreshMutation.isPending;
  const actionIsPending = refreshMutation.isPending || saveAndReloadIsPending;
  const sourceControlIsDisabled = fieldIsReadOnly || loadIsPending;
  const selectedSourceValue = draftConfig === null ? NoSkillsSourceValue : draftConfig.originUrl;
  const savedSelectedOriginUrl = persistedDraftConfig?.originUrl ?? null;
  const selectedSourceUsesBoundIntegration =
    selectedOriginUrl !== null &&
    sourceOptions.some((sourceOption) => sourceOption.originUrl === selectedOriginUrl);
  const selectedSourceHasUnpersistedChanges =
    selectedOriginUrl !== null &&
    (selectedOriginUrl !== savedSelectedOriginUrl ||
      (selectedSourceUsesBoundIntegration && input.integrationRowsHaveUnpersistedChanges));
  const autoLoadKey =
    selectedOriginUrl === null
      ? null
      : `${input.profileId}:${String(input.version.version)}:${selectedOriginUrl}`;
  const autoLoadHasBeenAttempted =
    autoLoadKey !== null && attemptedAutoLoadKeysRef.current.has(autoLoadKey);

  const buildDraftChanges = useCallback((): SandboxProfileSkillsConfig => {
    return normalizeSkillsConfig(draftConfigRef.current);
  }, []);
  const applySavedSkillsConfig = useCallback((skillsConfig: SandboxProfileSkillsConfig): void => {
    setDraftConfig(skillsConfig);
    setPersistedDraftConfig(skillsConfig);
    setSaveErrorMessage(null);
  }, []);
  const applyDraftSaveError = useCallback((error: unknown): void => {
    setSaveErrorMessage(
      resolveApiErrorMessage({
        error,
        fallbackMessage: "Could not save sandbox profile skills.",
      }),
    );
  }, []);
  const applyDraftValidationError = useCallback((message: string): void => {
    setSaveErrorMessage(message);
  }, []);

  useEffect(() => {
    setDraftConfig(persistedConfig);
    setPersistedDraftConfig(persistedConfig);
    setSkillsSearchQuery("");
    setSaveErrorMessage(null);
    setSaveAndReloadDialogIsOpen(false);
  }, [input.version.sandboxProfileId, input.version.version, persistedConfig]);

  useEffect(() => {
    input.onDraftStateChange?.({
      skillsConfig: draftConfig,
      sourceVersionKey: createSkillsDraftSourceVersionKey(input.version),
      saveBlockedMessage,
      applyDraftValidationError,
      applyDraftSaveError,
      applySavedSkillsConfig,
      buildDraftChanges,
      hasUnpersistedChanges: !skillsConfigsAreEqual(draftConfig, persistedDraftConfig),
    });
  }, [
    applyDraftSaveError,
    applyDraftValidationError,
    applySavedSkillsConfig,
    buildDraftChanges,
    draftConfig,
    input.onDraftStateChange,
    input.version,
    persistedDraftConfig,
    saveBlockedMessage,
  ]);

  useEffect(() => {
    if (
      autoLoadKey === null ||
      selectedOriginUrl === null ||
      !input.isDraft ||
      input.readOnly ||
      input.disabled ||
      !automaticLoadingIsEnabled ||
      sourceIsUnavailable ||
      selectedOriginUrl !== savedSelectedOriginUrl ||
      selectedSourceHasUnpersistedChanges ||
      skillsSourceQuery.isPending ||
      skillsSourceQuery.isError ||
      refreshMutation.isPending ||
      skillsSourceRepo !== null ||
      attemptedAutoLoadKeysRef.current.has(autoLoadKey)
    ) {
      return;
    }

    // Synchronizes the editor with the server-side skills catalog after the query confirms
    // this saved source has no loaded record yet.
    attemptedAutoLoadKeysRef.current.add(autoLoadKey);
    refreshMutation.mutate(selectedOriginUrl);
  }, [
    autoLoadKey,
    automaticLoadingIsEnabled,
    input.disabled,
    input.isDraft,
    input.readOnly,
    refreshMutation,
    savedSelectedOriginUrl,
    selectedOriginUrl,
    selectedSourceHasUnpersistedChanges,
    skillsSourceQuery.isError,
    skillsSourceQuery.isPending,
    skillsSourceRepo,
    sourceIsUnavailable,
  ]);

  function updateSelectedSource(value: string | null): void {
    if (value === null) {
      return;
    }

    if (value === NoSkillsSourceValue) {
      setDraftConfig(null);
      setSaveErrorMessage(null);
      return;
    }

    if (value === AddPublicGitHubSourceValue) {
      openPublicSourceDialog();
      return;
    }

    const selectedSource =
      selectableSourceOptions.find((sourceOption) => sourceOption.originUrl === value) ?? null;
    if (selectedSource === null) {
      setSaveErrorMessage("Selected skills source is not available.");
      return;
    }

    setDraftConfig({
      originUrl: selectedSource.originUrl,
      selectedSkills: [],
    });
    setSaveErrorMessage(null);
  }

  function openPublicSourceDialog(): void {
    setPublicSourceUrl("");
    setPublicSourceErrorMessage(null);
    setPublicSourceDialogIsOpen(true);
  }

  function addPublicGitHubSource(): void {
    const publicSourceOption = createPublicGitHubSkillsSourceOption(publicSourceUrl);
    if (publicSourceOption === null) {
      setPublicSourceErrorMessage(
        "Enter a public GitHub repository URL like https://github.com/mistlehq/skills",
      );
      return;
    }

    setDraftConfig({
      originUrl: publicSourceOption.originUrl,
      selectedSkills: [],
    });
    setPublicSourceDialogIsOpen(false);
    setPublicSourceUrl("");
    setPublicSourceErrorMessage(null);
    setSaveErrorMessage(null);
  }

  function updateSkillSelection(skill: SelectedSkill, selected: boolean): void {
    if (draftConfigRef.current === null) {
      return;
    }

    setDraftConfig((currentConfig) => {
      if (currentConfig === null) {
        return currentConfig;
      }

      const nextSelectedSkills = selected
        ? upsertSelectedSkill(currentConfig.selectedSkills, skill)
        : currentConfig.selectedSkills.filter(
            (selectedSkill) => selectedSkill.relativePath !== skill.relativePath,
          );

      return normalizeSkillsConfig({
        originUrl: currentConfig.originUrl,
        selectedSkills: [...nextSelectedSkills],
      });
    });
    setSaveErrorMessage(null);
  }

  function toggleAllVisibleDiscoveredSkills(): void {
    if (draftConfigRef.current === null || skillsSourceRepo === null) {
      return;
    }

    setDraftConfig(
      createNextVisibleDiscoveredSkillsSelection({
        allVisibleDiscoveredSkillsSelected,
        currentConfig: draftConfigRef.current,
        visibleSkills: visibleAvailableSkillOptions,
      }),
    );
    setSaveErrorMessage(null);
  }

  function reloadSelectedSource(): void {
    if (selectedOriginUrl === null || fieldIsReadOnly || actionIsPending) {
      return;
    }

    if (selectedSourceHasUnpersistedChanges) {
      setSaveAndReloadDialogIsOpen(true);
      return;
    }

    refreshMutation.mutate(selectedOriginUrl);
  }

  async function saveDraftAndReloadSelectedSource(): Promise<void> {
    if (selectedOriginUrl === null || input.onSaveDraftBeforeSkillsReload === undefined) {
      return;
    }

    setSaveAndReloadIsPending(true);
    try {
      const draftSaved = await input.onSaveDraftBeforeSkillsReload();
      if (!draftSaved) {
        return;
      }

      setSaveAndReloadDialogIsOpen(false);
      refreshMutation.mutate(selectedOriginUrl);
    } finally {
      setSaveAndReloadIsPending(false);
    }
  }

  const loadErrorMessage =
    skillsSourceQuery.isError && selectedOriginUrl !== null
      ? resolveApiErrorMessage({
          error: skillsSourceQuery.error,
          fallbackMessage: "Could not load sandbox profile skills.",
        })
      : null;
  const sourceNotLoadedMessage =
    selectedOriginUrl !== null &&
    !loadIsPending &&
    !skillsSourceQuery.isError &&
    skillsSourceRepo === null &&
    !selectedSourceHasUnpersistedChanges &&
    (autoLoadHasBeenAttempted || !automaticLoadingIsEnabled)
      ? "Skills have not been loaded for this repository yet."
      : null;
  const sourceNeedsSavedDraftMessage =
    selectedOriginUrl !== null &&
    !loadIsPending &&
    !skillsSourceQuery.isError &&
    skillsSourceRepo === null &&
    selectedSourceHasUnpersistedChanges
      ? "Save this draft to load skills from the selected repository."
      : null;
  const unavailableSelectedSkillsMessage =
    unavailableSelectedSkills.length === 0
      ? null
      : "Remove skills that are no longer found before publishing this sandbox profile.";
  const selectedCountText =
    unavailableSelectedSkills.length === 0
      ? `${String(selectedSkills.length)} selected`
      : `${String(selectedSkills.length)} selected, ${String(unavailableSelectedSkills.length)} no longer found`;
  const reloadButtonIsVisible =
    selectedOriginUrl !== null &&
    !fieldIsReadOnly &&
    !sourceIsUnavailable &&
    (skillsSourceRepo !== null ||
      refreshMutation.isError ||
      loadErrorMessage !== null ||
      sourceNotLoadedMessage !== null ||
      sourceNeedsSavedDraftMessage !== null);
  const selectedSourceLabel =
    selectedOriginUrl === null ? "None" : (selectedSourceOption?.label ?? "Unavailable repository");
  const skillsSourceAction = (
    <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
      {fieldIsReadOnly ? (
        <div className="flex min-h-9 min-w-0 items-center truncate text-sm font-medium text-foreground sm:max-w-72">
          {selectedSourceLabel}
        </div>
      ) : (
        <Select
          disabled={sourceControlIsDisabled}
          onValueChange={updateSelectedSource}
          value={selectedSourceValue}
        >
          <SelectTrigger
            aria-label="Source repository"
            className="min-w-0 flex-1 sm:min-w-56 sm:max-w-72"
            id="sandbox-profile-skills-source"
          >
            <SelectValue placeholder="Select repository">{selectedSourceLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NoSkillsSourceValue}>None</SelectItem>
            {sourceIsUnavailable && draftConfig !== null ? (
              <SelectItem disabled value={draftConfig.originUrl}>
                Unavailable repository
              </SelectItem>
            ) : null}
            {selectableSourceOptions.map((sourceOption) => (
              <SelectItem key={sourceOption.originUrl} value={sourceOption.originUrl}>
                {sourceOption.label}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem
              className="text-primary focus:text-primary"
              onClick={openPublicSourceDialog}
              value={AddPublicGitHubSourceValue}
            >
              <span className="flex items-center gap-2">
                <PlusIcon aria-hidden className="size-4" />
                Add public GitHub repo
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      )}
      {reloadButtonIsVisible ? (
        <Button
          aria-label="Reload skills"
          disabled={actionIsPending || loadIsPending}
          onClick={reloadSelectedSource}
          title="Reload skills from this repository"
          type="button"
          variant="outline"
        >
          {actionIsPending || queryLoadIsPending ? (
            <Spinner aria-hidden className="size-4" />
          ) : (
            <ArrowClockwiseIcon aria-hidden className="size-4" />
          )}
          <span className="hidden sm:inline">Reload</span>
        </Button>
      ) : null}
    </div>
  );
  const skillsContent =
    selectedOriginUrl === null || loadIsPending ? null : shouldShowEditableSkillCatalog &&
      skillOptions.length === 0 ? (
      <p className="text-muted-foreground text-sm">No skills found in this repository.</p>
    ) : (
      <div className="grid gap-3">
        <div className="overflow-hidden rounded-md border bg-card">
          {shouldShowEditableSkillCatalog ? (
            <div className="flex flex-col gap-2 border-b bg-muted/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <label className="inline-flex min-w-0 items-center gap-2">
                  <Checkbox
                    checked={allVisibleDiscoveredSkillsSelected}
                    disabled={visibleAvailableSkillOptions.length === 0}
                    indeterminate={someVisibleDiscoveredSkillsSelected}
                    onCheckedChange={toggleAllVisibleDiscoveredSkills}
                  />
                  <span>Select all</span>
                </label>
                <span className="text-muted-foreground text-sm">{selectedCountText}</span>
              </div>
              <div className="min-w-0">
                <Input
                  aria-label="Search skills"
                  className="h-8 w-full bg-background sm:w-64"
                  onChange={(event) => {
                    setSkillsSearchQuery(event.target.value);
                  }}
                  placeholder="Search skills"
                  value={skillsSearchQuery}
                />
              </div>
            </div>
          ) : null}
          <div
            aria-label={shouldShowEditableSkillCatalog ? "Available skills" : "Selected skills"}
            className="divide-y"
            data-slot="sandbox-profile-skills-list"
            role="region"
            style={shouldShowEditableSkillCatalog ? SkillsListHeightStyle : undefined}
          >
            {shouldShowEditableSkillCatalog
              ? skillOptions.map((skill) => {
                  if (!skill.available) {
                    return (
                      <UnavailableSkillRow
                        key={`${skill.relativePath}:${skill.name}:missing`}
                        onRemove={() => {
                          updateSkillSelection(skill, false);
                        }}
                        skill={skill}
                      />
                    );
                  }

                  if (!skillMatchesSearchQuery(skill, skillsSearchQuery)) {
                    return null;
                  }

                  const checked = selectedSkillIdentities.has(createSelectedSkillIdentity(skill));
                  return (
                    <SelectableSkillRow
                      checked={checked}
                      fieldIsReadOnly={fieldIsReadOnly}
                      key={skill.relativePath}
                      onCheckedChange={(nextChecked) => {
                        updateSkillSelection(skill, nextChecked);
                      }}
                      skill={skill}
                    />
                  );
                })
              : selectedSkillOptions.map((skill) =>
                  skill.available ? (
                    <SelectedSkillRow key={skill.relativePath} skill={skill} />
                  ) : (
                    <ReadOnlyUnavailableSkillRow
                      key={`${skill.relativePath}:${skill.name}:missing`}
                      skill={skill}
                    />
                  ),
                )}
            {shouldShowEditableSkillCatalog && visibleAvailableSkillOptions.length === 0 ? (
              <p className="text-muted-foreground px-3 py-3 text-sm">
                No matching discovered skills.
              </p>
            ) : null}
            {!shouldShowEditableSkillCatalog && selectedSkillOptions.length === 0 ? (
              <p className="text-muted-foreground px-3 py-3 text-sm">No skills selected.</p>
            ) : null}
          </div>
        </div>
      </div>
    );

  return (
    <SectionBlock action={skillsSourceAction} title="Skills">
      <div className="grid gap-4">
        {saveErrorMessage === null ? null : <Notice variant="alert">{saveErrorMessage}</Notice>}
        {loadErrorMessage === null ? null : (
          <Notice title="Could not load skills" variant="alert">
            {loadErrorMessage}
          </Notice>
        )}
        {sourceNotLoadedMessage === null ? null : (
          <Notice title="Skills not loaded">{sourceNotLoadedMessage}</Notice>
        )}
        {sourceNeedsSavedDraftMessage === null ? null : (
          <Notice title="Save draft to load skills">{sourceNeedsSavedDraftMessage}</Notice>
        )}
        {sourceIsUnavailable ? (
          <Notice title="Skills source unavailable" variant="alert">
            Add this repository back to the Git integration bindings, or choose another skills
            source.
          </Notice>
        ) : null}
        {unavailableSelectedSkillsMessage === null ? null : (
          <Notice title="Selected skills no longer found" variant="alert">
            {unavailableSelectedSkillsMessage}
          </Notice>
        )}
        {skillsContent}
      </div>
      <Dialog
        onOpenChange={(open) => {
          setPublicSourceDialogIsOpen(open);
          if (!open) {
            setPublicSourceUrl("");
            setPublicSourceErrorMessage(null);
          }
        }}
        open={publicSourceDialogIsOpen}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              addPublicGitHubSource();
            }}
          >
            <DialogHeader>
              <DialogTitle>Add public GitHub repo</DialogTitle>
            </DialogHeader>
            <Field contentWidth="fill">
              <FieldHeader>
                <FieldLabel htmlFor="sandbox-profile-public-skills-source-url">
                  Repository URL
                </FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Input
                  id="sandbox-profile-public-skills-source-url"
                  onChange={(event) => {
                    setPublicSourceUrl(event.target.value);
                    setPublicSourceErrorMessage(null);
                  }}
                  placeholder="e.g. https://github.com/mistlehq/skills"
                  value={publicSourceUrl}
                />
              </FieldContent>
            </Field>
            {publicSourceErrorMessage === null ? null : (
              <Notice variant="alert">{publicSourceErrorMessage}</Notice>
            )}
            <DialogFooter>
              <Button
                onClick={() => {
                  setPublicSourceDialogIsOpen(false);
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">Add repository</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open && !saveAndReloadIsPending) {
            setSaveAndReloadDialogIsOpen(false);
          }
        }}
        open={saveAndReloadDialogIsOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save and reload skills?</DialogTitle>
            <DialogDescription>
              Reloading skills uses the latest saved draft. Save this draft first so the selected
              source is available to the skills loader.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={saveAndReloadIsPending}
              onClick={() => {
                setSaveAndReloadDialogIsOpen(false);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={saveAndReloadIsPending}
              onClick={() => {
                void saveDraftAndReloadSelectedSource();
              }}
              type="button"
            >
              {saveAndReloadIsPending ? <Spinner aria-hidden className="size-4" /> : null}
              Save and reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionBlock>
  );
}

function SelectableSkillRow(input: {
  checked: boolean;
  fieldIsReadOnly: boolean;
  onCheckedChange: (nextChecked: boolean) => void;
  skill: SkillOption;
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-accent focus-within:bg-accent sm:gap-3 sm:py-3">
      <Checkbox
        checked={input.checked}
        className="mt-0.5"
        disabled={input.fieldIsReadOnly}
        onCheckedChange={(nextChecked) => {
          input.onCheckedChange(nextChecked === true);
        }}
      />
      <SkillRowBody skill={input.skill} />
    </label>
  );
}

function SelectedSkillRow(input: { skill: SkillOption }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 text-sm sm:gap-3 sm:py-3">
      <SkillRowBody skill={input.skill} />
    </div>
  );
}

function UnavailableSkillRow(input: {
  onRemove: () => void;
  skill: SkillOption;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 bg-destructive/5 px-3 py-2.5 text-sm transition-colors hover:bg-destructive/10 focus-within:bg-destructive/10 sm:gap-3 sm:py-3">
      <Checkbox checked disabled className="mt-0.5" />
      <SkillRowBody
        badge={
          <span className="rounded border border-destructive/30 bg-background px-1.5 py-0.5 text-xs font-medium text-destructive">
            No longer found
          </span>
        }
        showMobilePath
        skill={input.skill}
      />
      <Button onClick={input.onRemove} size="sm" type="button" variant="outline">
        Remove
      </Button>
    </div>
  );
}

function ReadOnlyUnavailableSkillRow(input: { skill: SkillOption }): React.JSX.Element {
  return (
    <div className="bg-destructive/5 px-3 py-2.5 text-sm sm:py-3">
      <SkillRowBody
        badge={
          <span className="rounded border border-destructive/30 bg-background px-1.5 py-0.5 text-xs font-medium text-destructive">
            No longer found
          </span>
        }
        showMobilePath
        skill={input.skill}
      />
    </div>
  );
}

function SkillRowBody(input: {
  badge?: ReactNode | undefined;
  showMobilePath?: boolean | undefined;
  skill: Pick<SkillOption, "description" | "name" | "relativePath">;
}): React.JSX.Element {
  return (
    <span className="-mt-0.5 grid min-w-0 flex-1 gap-1">
      <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium">{input.skill.name}</span>
          {input.badge}
        </span>
        <OverflowTooltipText
          className="font-mono text-xs text-muted-foreground"
          containerClassName="hidden max-w-[45%] shrink-0 sm:block"
          text={input.skill.relativePath}
          tooltipSide="top"
          truncatePosition="start"
        />
      </span>
      {input.skill.description.length === 0 ? null : (
        <span className="text-muted-foreground line-clamp-3 sm:line-clamp-none">
          {input.skill.description}
        </span>
      )}
      {input.showMobilePath === true ? (
        <span className="text-muted-foreground font-mono text-xs sm:hidden">
          {input.skill.relativePath}
        </span>
      ) : null}
    </span>
  );
}

export function resolveSkillsSourceRepositoryOptions(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  integrationRows: readonly SandboxProfileBindingEditorRow[];
}): readonly SkillsSourceRepositoryOption[] {
  const optionsByOriginUrl = new Map<string, SkillsSourceRepositoryOption>();

  for (const row of input.integrationRows) {
    if (row.kind !== "git") {
      continue;
    }

    const connection = input.availableConnections.find(
      (candidate) => candidate.id === row.connectionId,
    );
    if (connection === undefined) {
      continue;
    }

    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    if (target === undefined || target.familyId !== "github") {
      continue;
    }

    const webBaseUrl = readStringField(target.config, "web_base_url");
    const repositories = readStringArrayField(row.config, "repositories");
    if (webBaseUrl === null || repositories === null) {
      continue;
    }

    for (const repository of repositories) {
      const option = createSkillsSourceRepositoryOption({
        repository,
        webBaseUrl,
      });
      if (!optionsByOriginUrl.has(option.originUrl)) {
        optionsByOriginUrl.set(option.originUrl, option);
      }
    }
  }

  return [...optionsByOriginUrl.values()].sort(compareSkillsSourceRepositoryOptions);
}

function createSkillsSourceRepositoryOption(input: {
  repository: string;
  webBaseUrl: string;
}): SkillsSourceRepositoryOption {
  const originUrl = new URL(input.webBaseUrl);
  const pathnameWithoutTrailingSlash = originUrl.pathname.endsWith("/")
    ? originUrl.pathname.slice(0, -1)
    : originUrl.pathname;
  const basePath = pathnameWithoutTrailingSlash === "/" ? "" : pathnameWithoutTrailingSlash;
  originUrl.pathname = `${basePath}/${input.repository}.git`;
  originUrl.search = "";
  originUrl.hash = "";

  return {
    label: input.repository,
    originUrl: originUrl.toString(),
  };
}

function createPublicGitHubSkillsSourceOption(input: string): SkillsSourceRepositoryOption | null {
  const originUrl = canonicalizePublicGitHubSkillsSourceOriginUrl(input);
  if (originUrl === null) {
    return null;
  }

  const parsedOriginUrl = new URL(originUrl);
  const [owner, rawRepository] = parsedOriginUrl.pathname
    .split("/")
    .filter((part) => part.length > 0);
  if (owner === undefined || rawRepository === undefined) {
    return null;
  }

  return {
    label: `${owner}/${rawRepository.slice(0, -".git".length)}`,
    originUrl,
  };
}

export function canonicalizePublicGitHubSkillsSourceOriginUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return null;
  }

  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  if (pathParts.length !== 2) {
    return null;
  }

  const [owner, rawRepository] = pathParts;
  const repository = rawRepository?.endsWith(".git")
    ? rawRepository.slice(0, -".git".length)
    : rawRepository;
  if (
    owner === undefined ||
    repository === undefined ||
    repository.length === 0 ||
    !isValidGitHubPathPart(owner) ||
    !isValidGitHubPathPart(repository)
  ) {
    return null;
  }

  return `https://github.com/${owner}/${repository}.git`;
}

function isValidGitHubPathPart(input: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(input) && !input.startsWith(".") && !input.endsWith(".");
}

function compareSkillsSourceRepositoryOptions(
  left: SkillsSourceRepositoryOption,
  right: SkillsSourceRepositoryOption,
): number {
  return left.label.localeCompare(right.label) || left.originUrl.localeCompare(right.originUrl);
}

function readStringField(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringArrayField(
  input: Record<string, unknown>,
  field: string,
): readonly string[] | null {
  const value = input[field];
  if (!Array.isArray(value)) {
    return null;
  }

  const values = value.filter((item): item is string => typeof item === "string");
  return values.length === value.length ? values : null;
}

export function createSkillOptions(input: {
  selectedSkills: readonly SelectedSkill[];
  skillsSourceRepo: SandboxProfileVersionSkillsSourceRepo | null;
}): readonly SkillOption[] {
  const loadedSkillsByPath = new Map(
    (input.skillsSourceRepo?.skills ?? []).map((skill) => [skill.relativePath, skill]),
  );
  const options: SkillOption[] = [];

  for (const skill of input.skillsSourceRepo?.skills ?? []) {
    options.push({
      name: skill.name,
      description: skill.description,
      relativePath: skill.relativePath,
      available: true,
    });
  }

  for (const skill of input.selectedSkills) {
    const loadedSkill = loadedSkillsByPath.get(skill.relativePath);
    if (loadedSkill?.name === skill.name) {
      continue;
    }

    options.push({
      name: skill.name,
      description: "",
      relativePath: skill.relativePath,
      available: false,
    });
  }

  return options.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.relativePath.localeCompare(right.relativePath),
  );
}

function createSelectedSkillOption(skill: SelectedSkill): SkillOption {
  return {
    name: skill.name,
    description: "",
    relativePath: skill.relativePath,
    available: true,
  };
}

export function createNextVisibleDiscoveredSkillsSelection(input: {
  allVisibleDiscoveredSkillsSelected: boolean;
  currentConfig: NonNullable<SandboxProfileSkillsConfig>;
  visibleSkills: readonly SelectedSkill[];
}): NonNullable<SandboxProfileSkillsConfig> {
  const visibleSkillPaths = new Set(input.visibleSkills.map((skill) => skill.relativePath));
  const retainedSelectedSkills = input.currentConfig.selectedSkills.filter(
    (skill) => !visibleSkillPaths.has(skill.relativePath),
  );
  const nextSelectedSkills = input.allVisibleDiscoveredSkillsSelected
    ? retainedSelectedSkills
    : [
        ...retainedSelectedSkills,
        ...input.visibleSkills.map((skill) => ({
          name: skill.name,
          relativePath: skill.relativePath,
        })),
      ];

  return {
    originUrl: input.currentConfig.originUrl,
    selectedSkills: nextSelectedSkills.sort(compareSelectedSkills),
  };
}

function upsertSelectedSkill(
  selectedSkills: readonly SelectedSkill[],
  skill: SelectedSkill,
): readonly SelectedSkill[] {
  const selectedSkillsByPath = new Map<string, SelectedSkill>();
  for (const selectedSkill of selectedSkills) {
    selectedSkillsByPath.set(selectedSkill.relativePath, selectedSkill);
  }
  selectedSkillsByPath.set(skill.relativePath, {
    name: skill.name,
    relativePath: skill.relativePath,
  });

  return [...selectedSkillsByPath.values()].sort(compareSelectedSkills);
}

export function normalizeSkillsConfig(
  skillsConfig: SandboxProfileSkillsConfig,
): SandboxProfileSkillsConfig {
  if (skillsConfig === null) {
    return null;
  }

  return {
    originUrl: skillsConfig.originUrl,
    selectedSkills: [...skillsConfig.selectedSkills].sort(compareSelectedSkills),
  };
}

function compareSelectedSkills(left: SelectedSkill, right: SelectedSkill): number {
  return left.relativePath.localeCompare(right.relativePath) || left.name.localeCompare(right.name);
}

function createSelectedSkillIdentity(skill: SelectedSkill): string {
  return `${skill.relativePath}\u0000${skill.name}`;
}

function skillMatchesSearchQuery(skill: SkillOption, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return [skill.name, skill.description, skill.relativePath].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function skillsConfigsAreEqual(
  left: SandboxProfileSkillsConfig,
  right: SandboxProfileSkillsConfig,
): boolean {
  const normalizedLeft = normalizeSkillsConfig(left);
  const normalizedRight = normalizeSkillsConfig(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return normalizedLeft === normalizedRight;
  }

  if (normalizedLeft.originUrl !== normalizedRight.originUrl) {
    return false;
  }

  if (normalizedLeft.selectedSkills.length !== normalizedRight.selectedSkills.length) {
    return false;
  }

  return normalizedLeft.selectedSkills.every((leftSkill, index) => {
    const rightSkill = normalizedRight.selectedSkills[index];
    return (
      rightSkill !== undefined &&
      leftSkill.name === rightSkill.name &&
      leftSkill.relativePath === rightSkill.relativePath
    );
  });
}
