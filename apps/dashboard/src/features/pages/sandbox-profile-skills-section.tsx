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
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@mistle/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";

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
const UnavailableSkillsSourceSaveBlockedMessage =
  "Choose an available skills source, or clear the skills source before saving.";

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
  const attemptedAutoLoadKeysRef = useRef(new Set<string>());
  const draftConfigRef = useRef(draftConfig);
  draftConfigRef.current = draftConfig;

  const selectedOriginUrl = draftConfig?.originUrl ?? null;
  const selectedSourceOption =
    selectedOriginUrl === null
      ? null
      : (sourceOptions.find((sourceOption) => sourceOption.originUrl === selectedOriginUrl) ??
        null);
  const saveBlockedMessage = resolveSkillsConfigSaveBlockedMessage({
    skillsConfig: draftConfig,
    sourceOptions,
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

  const skillsSourceRepo = resolveSkillsSourceRepo(skillsSourceQuery.data, selectedOriginUrl);
  const selectedSkills = draftConfig?.selectedSkills ?? [];
  const skillOptions = createSkillOptions({
    selectedSkills,
    skillsSourceRepo,
  });
  const availableSkillOptions = skillOptions.filter((skill) => skill.available);
  const visibleAvailableSkillOptions = availableSkillOptions.filter((skill) =>
    skillMatchesSearchQuery(skill, skillsSearchQuery),
  );
  const unavailableSelectedSkills =
    skillsSourceRepo === null ? [] : skillOptions.filter((skill) => !skill.available);
  const selectedSkillIdentities = new Set(selectedSkills.map(createSelectedSkillIdentity));
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
  const automaticLoadingIsEnabled = input.automaticLoadingEnabled !== false;
  const queryLoadIsPending = selectedOriginUrl !== null && skillsSourceQuery.isPending;
  const loadIsPending = queryLoadIsPending || refreshMutation.isPending;
  const actionIsPending = refreshMutation.isPending || saveAndReloadIsPending;
  const sourceControlIsDisabled =
    fieldIsReadOnly || loadIsPending || (sourceOptions.length === 0 && selectedOriginUrl === null);
  const selectedSourceValue = selectedOriginUrl ?? NoSkillsSourceValue;
  const savedSelectedOriginUrl = persistedDraftConfig?.originUrl ?? null;
  const selectedSourceHasUnpersistedChanges =
    selectedOriginUrl !== null &&
    (selectedOriginUrl !== savedSelectedOriginUrl || input.integrationRowsHaveUnpersistedChanges);
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

    setDraftConfig({
      originUrl: value,
      selectedSkills: [],
    });
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
    !sourceIsUnavailable &&
    (skillsSourceRepo !== null ||
      refreshMutation.isError ||
      loadErrorMessage !== null ||
      sourceNotLoadedMessage !== null ||
      sourceNeedsSavedDraftMessage !== null);
  const skillsContent =
    selectedOriginUrl === null ||
    loadIsPending ||
    skillsSourceRepo === null ? null : skillOptions.length === 0 ? (
      <p className="text-muted-foreground text-sm">No skills found in this repository.</p>
    ) : (
      <div className="grid gap-3">
        <div className="divide-y rounded-md border">
          <div className="flex flex-col gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/60 focus-within:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="inline-flex min-w-0 items-center gap-2">
                <Checkbox
                  checked={allVisibleDiscoveredSkillsSelected}
                  disabled={fieldIsReadOnly || visibleAvailableSkillOptions.length === 0}
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
                className="h-8 w-full sm:w-64"
                onChange={(event) => {
                  setSkillsSearchQuery(event.target.value);
                }}
                placeholder="Search skills"
                value={skillsSearchQuery}
              />
            </div>
          </div>
          {skillOptions.map((skill) => {
            if (!skill.available) {
              return (
                <div
                  className="flex items-start gap-3 bg-destructive/5 px-3 py-3 text-sm transition-colors hover:bg-destructive/10 focus-within:bg-destructive/10"
                  key={`${skill.relativePath}:${skill.name}:missing`}
                >
                  <Checkbox checked disabled className="mt-0.5" />
                  <span className="-mt-0.5 grid min-w-0 flex-1 gap-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{skill.name}</span>
                      <span className="rounded border border-destructive/30 bg-background px-1.5 py-0.5 text-xs font-medium text-destructive">
                        No longer found
                      </span>
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {skill.relativePath}
                    </span>
                  </span>
                  <Button
                    disabled={fieldIsReadOnly}
                    onClick={() => {
                      updateSkillSelection(skill, false);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Remove
                  </Button>
                </div>
              );
            }

            if (!skillMatchesSearchQuery(skill, skillsSearchQuery)) {
              return null;
            }

            const checked = selectedSkillIdentities.has(createSelectedSkillIdentity(skill));
            return (
              <label
                className="flex items-start gap-3 px-3 py-3 text-sm transition-colors hover:bg-muted/60 focus-within:bg-muted/50"
                key={skill.relativePath}
              >
                <Checkbox
                  checked={checked}
                  className="mt-0.5"
                  disabled={fieldIsReadOnly}
                  onCheckedChange={(nextChecked) => {
                    updateSkillSelection(skill, nextChecked === true);
                  }}
                />
                <span className="-mt-0.5 grid min-w-0 gap-1">
                  <span className="font-medium">{skill.name}</span>
                  {skill.description.length === 0 ? null : (
                    <span className="text-muted-foreground">{skill.description}</span>
                  )}
                  <span className="text-muted-foreground font-mono text-xs">
                    {skill.relativePath}
                  </span>
                </span>
              </label>
            );
          })}
          {visibleAvailableSkillOptions.length === 0 ? (
            <p className="text-muted-foreground px-3 py-3 text-sm">
              No matching discovered skills.
            </p>
          ) : null}
        </div>
      </div>
    );

  return (
    <SectionBlock title="Skills">
      <SandboxProfileSectionCard>
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
          {sourceOptions.length === 0 && selectedOriginUrl === null ? (
            <Notice title="Git repository binding required">
              Add a Git repository binding before configuring skills.
            </Notice>
          ) : null}
          {unavailableSelectedSkillsMessage === null ? null : (
            <Notice title="Selected skills no longer found" variant="alert">
              {unavailableSelectedSkillsMessage}
            </Notice>
          )}
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel htmlFor="sandbox-profile-skills-source">Source repository</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <div className="flex flex-wrap gap-2">
                <Select
                  disabled={sourceControlIsDisabled}
                  onValueChange={updateSelectedSource}
                  value={selectedSourceValue}
                >
                  <SelectTrigger className="min-w-72" id="sandbox-profile-skills-source">
                    <SelectValue placeholder="Select repository">
                      {selectedOriginUrl === null
                        ? "None"
                        : (selectedSourceOption?.label ?? "Unavailable repository")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NoSkillsSourceValue}>None</SelectItem>
                    {sourceIsUnavailable ? (
                      <SelectItem disabled value={selectedOriginUrl}>
                        Unavailable repository
                      </SelectItem>
                    ) : null}
                    {sourceOptions.map((sourceOption) => (
                      <SelectItem key={sourceOption.originUrl} value={sourceOption.originUrl}>
                        {sourceOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reloadButtonIsVisible ? (
                  <Button
                    disabled={fieldIsReadOnly || actionIsPending || loadIsPending}
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
                    Reload
                  </Button>
                ) : null}
              </div>
            </FieldContent>
          </Field>
          {skillsContent}
        </div>
      </SandboxProfileSectionCard>
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

function resolveSkillsSourceRepo(
  result: SandboxProfileVersionSkillsSourceReposResult | undefined,
  originUrl: string | null,
): SandboxProfileVersionSkillsSourceRepo | null {
  if (originUrl === null || result === undefined) {
    return null;
  }

  return result.items.find((item) => item.originUrl === originUrl) ?? null;
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

  return [...optionsByOriginUrl.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.originUrl.localeCompare(right.originUrl),
  );
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
