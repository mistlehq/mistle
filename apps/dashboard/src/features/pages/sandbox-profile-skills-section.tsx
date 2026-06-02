import {
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Notice,
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@mistle/ui";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
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
  integrationRows: readonly SandboxProfileBindingEditorRow[];
  integrationRowsHaveUnpersistedChanges: boolean;
  isDraft: boolean;
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
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
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
  const skillOptions = createSkillOptions({
    selectedSkills: draftConfig?.selectedSkills ?? [],
    skillsSourceRepo,
  });
  const selectedSkillPaths = new Set(
    (draftConfig?.selectedSkills ?? []).map((skill) => skill.relativePath),
  );
  const fieldIsReadOnly = input.disabled || input.readOnly || !input.isDraft;
  const selectedSourceValue = selectedOriginUrl ?? NoSkillsSourceValue;

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
    setSaveErrorMessage(null);
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

  function selectAllDiscoveredSkills(): void {
    if (draftConfigRef.current === null || skillsSourceRepo === null) {
      return;
    }

    setDraftConfig({
      originUrl: draftConfigRef.current.originUrl,
      selectedSkills: skillsSourceRepo.skills
        .map((skill) => ({
          name: skill.name,
          relativePath: skill.relativePath,
        }))
        .sort(compareSelectedSkills),
    });
    setSaveErrorMessage(null);
  }

  function clearSelectedSkills(): void {
    if (draftConfigRef.current === null) {
      return;
    }

    setDraftConfig({
      originUrl: draftConfigRef.current.originUrl,
      selectedSkills: [],
    });
    setSaveErrorMessage(null);
  }

  function refreshSelectedSource(): void {
    if (
      selectedOriginUrl === null ||
      input.integrationRowsHaveUnpersistedChanges ||
      refreshMutation.isPending
    ) {
      return;
    }

    refreshMutation.mutate(selectedOriginUrl);
  }

  const skillsContent =
    selectedOriginUrl === null ? (
      <p className="text-muted-foreground text-sm">No skills source selected.</p>
    ) : skillsSourceQuery.isPending ? (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner aria-hidden className="size-4" />
        Loading skills...
      </div>
    ) : skillsSourceQuery.isError ? (
      <Notice title="Could not load skills" variant="alert">
        {resolveApiErrorMessage({
          error: skillsSourceQuery.error,
          fallbackMessage: "Could not load sandbox profile skills.",
        })}
      </Notice>
    ) : skillsSourceRepo === null ? (
      <p className="text-muted-foreground text-sm">Refresh this repository to discover skills.</p>
    ) : skillOptions.length === 0 ? (
      <p className="text-muted-foreground text-sm">No skills were discovered in this repository.</p>
    ) : (
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={fieldIsReadOnly || skillsSourceRepo.skills.length === 0}
            onClick={selectAllDiscoveredSkills}
            size="sm"
            type="button"
            variant="outline"
          >
            Select all
          </Button>
          <Button
            disabled={fieldIsReadOnly || selectedSkillPaths.size === 0}
            onClick={clearSelectedSkills}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear
          </Button>
          <span className="text-muted-foreground text-sm">{selectedSkillPaths.size} selected</span>
        </div>
        <div className="divide-y rounded-md border">
          {skillOptions.map((skill) => {
            const checked = selectedSkillPaths.has(skill.relativePath);
            return (
              <label
                className="flex cursor-pointer items-start gap-3 px-3 py-3 text-sm"
                key={skill.relativePath}
              >
                <Checkbox
                  checked={checked}
                  disabled={fieldIsReadOnly}
                  onCheckedChange={(nextChecked) => {
                    updateSkillSelection(skill, nextChecked === true);
                  }}
                />
                <span className="grid min-w-0 gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {skill.name}
                    {skill.available ? null : (
                      <span className="rounded border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        unavailable
                      </span>
                    )}
                  </span>
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
        </div>
      </div>
    );

  return (
    <SectionBlock title="Skills">
      <div className="grid gap-4">
        {saveErrorMessage === null ? null : <Notice variant="alert">{saveErrorMessage}</Notice>}
        {sourceIsUnavailable ? (
          <Notice title="Skills source unavailable" variant="alert">
            Add this repository back to the Git integration bindings, or choose another skills
            source.
          </Notice>
        ) : null}
        <Field contentWidth="fill">
          <FieldHeader>
            <FieldLabel htmlFor="sandbox-profile-skills-source">Source repository</FieldLabel>
          </FieldHeader>
          <FieldContent>
            <div className="flex flex-wrap gap-2">
              <Select
                disabled={
                  fieldIsReadOnly || (sourceOptions.length === 0 && selectedOriginUrl === null)
                }
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
              <Button
                disabled={
                  selectedOriginUrl === null ||
                  fieldIsReadOnly ||
                  input.integrationRowsHaveUnpersistedChanges ||
                  refreshMutation.isPending
                }
                onClick={refreshSelectedSource}
                type="button"
                variant="outline"
              >
                {refreshMutation.isPending ? (
                  <Spinner aria-hidden className="size-4" />
                ) : (
                  <ArrowsClockwiseIcon aria-hidden className="size-4" />
                )}
                Refresh
              </Button>
            </div>
            {input.integrationRowsHaveUnpersistedChanges && selectedOriginUrl !== null ? (
              <p className="text-muted-foreground mt-2 text-sm">
                Save integration changes before refreshing skills.
              </p>
            ) : null}
            {sourceOptions.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                Add a Git repository binding before configuring skills.
              </p>
            ) : null}
          </FieldContent>
        </Field>
        {skillsContent}
      </div>
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
  const optionsByPath = new Map<string, SkillOption>();

  for (const skill of input.skillsSourceRepo?.skills ?? []) {
    optionsByPath.set(skill.relativePath, {
      name: skill.name,
      description: skill.description,
      relativePath: skill.relativePath,
      available: true,
    });
  }

  for (const skill of input.selectedSkills) {
    if (optionsByPath.has(skill.relativePath)) {
      continue;
    }

    optionsByPath.set(skill.relativePath, {
      name: skill.name,
      description: "",
      relativePath: skill.relativePath,
      available: false,
    });
  }

  return [...optionsByPath.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.relativePath.localeCompare(right.relativePath),
  );
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
