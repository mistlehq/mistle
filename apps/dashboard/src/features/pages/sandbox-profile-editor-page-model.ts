import type {
  PublishSandboxProfileVersionResult,
  SandboxProfile,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";

export type SandboxProfileRouteView = "published" | "draft";

export type SandboxProfileEditorVersionMode =
  | {
      kind: "draft";
      version: number;
      activeVersion: number | null;
      hasDraft: true;
    }
  | {
      kind: "active";
      version: number;
      activeVersion: number | null;
      hasDraft: boolean;
      draftVersion: number | null;
    };

export type SetupAssistantStartDialogVariant = "choice" | "save-required" | "use-saved-required";

export function resolveSetupAssistantCloseSandboxInstanceId(input: {
  currentPanelSandboxInstanceId: string | null;
  dialogSandboxInstanceId: string | null;
}): string | null {
  return input.dialogSandboxInstanceId ?? input.currentPanelSandboxInstanceId;
}

type ResolveEditorVersionModeResult =
  | {
      ok: true;
      mode: SandboxProfileEditorVersionMode;
    }
  | {
      ok: false;
      message: string;
    };

export function resolveSandboxProfileEditorVersionMode(input: {
  activeVersion: number | null;
  versions: readonly SandboxProfileVersion[];
  view: SandboxProfileRouteView;
}): ResolveEditorVersionModeResult {
  const draftVersions = input.versions.filter((version) => version.state === "draft");
  const publishedVersions = input.versions.filter((version) => version.state === "published");
  if (draftVersions.length > 1) {
    return {
      ok: false,
      message: "Sandbox profile has multiple draft versions.",
    };
  }

  const draftVersion = draftVersions[0] ?? null;
  const activeVersion =
    input.activeVersion === null
      ? null
      : (input.versions.find((version) => version.version === input.activeVersion) ?? null);
  const latestPublishedVersion =
    publishedVersions.length === 0
      ? null
      : publishedVersions.reduce((latestVersion, currentVersion) =>
          currentVersion.version > latestVersion.version ? currentVersion : latestVersion,
        );

  if (input.activeVersion !== null && activeVersion === null) {
    return {
      ok: false,
      message: "Sandbox profile active version could not be loaded.",
    };
  }

  if (input.view === "draft") {
    if (draftVersion === null) {
      return {
        ok: false,
        message: "Sandbox profile draft version could not be loaded.",
      };
    }

    return {
      ok: true,
      mode: {
        kind: "draft",
        version: draftVersion.version,
        activeVersion: input.activeVersion,
        hasDraft: true,
      },
    };
  }

  if (latestPublishedVersion !== null) {
    return {
      ok: true,
      mode: {
        kind: "active",
        version: latestPublishedVersion.version,
        activeVersion: input.activeVersion,
        hasDraft: draftVersion !== null,
        draftVersion: draftVersion?.version ?? null,
      },
    };
  }

  return {
    ok: false,
    message: "Sandbox profile published version could not be loaded.",
  };
}

export function shouldPollSandboxProfileSnapshotJobs(
  versions: readonly SandboxProfileVersion[] | undefined,
): boolean {
  if (versions === undefined) {
    return false;
  }

  return versions.some(
    (version) =>
      version.state === "published" &&
      (version.latestSnapshotJob?.state === "queued" ||
        version.latestSnapshotJob?.state === "running"),
  );
}

export function shouldRedirectDraftSandboxProfileViewToPublished(input: {
  versions: readonly SandboxProfileVersion[];
}): boolean {
  const hasDraftVersion = input.versions.some((version) => version.state === "draft");
  const hasPublishedVersion = input.versions.some((version) => version.state === "published");

  return !hasDraftVersion && hasPublishedVersion;
}

export function applyPublishedSandboxProfileVersionToProfile(input: {
  profile: SandboxProfile | undefined;
  result: PublishSandboxProfileVersionResult;
}): SandboxProfile | undefined {
  if (input.profile === undefined) {
    return undefined;
  }

  return {
    ...input.profile,
    activeVersion: input.result.activeVersion,
  };
}

export function resolveSetupAssistantStartDialogVariant(input: {
  latestSavedDraftHasAgentRuntime: boolean;
  localDraftHasAgentRuntime: boolean;
}): SetupAssistantStartDialogVariant {
  if (!input.latestSavedDraftHasAgentRuntime) {
    return "save-required";
  }

  return input.localDraftHasAgentRuntime ? "choice" : "use-saved-required";
}

export function applyPublishedSandboxProfileVersionToVersions(input: {
  versions: readonly SandboxProfileVersion[] | undefined;
  result: PublishSandboxProfileVersionResult;
}): readonly SandboxProfileVersion[] | undefined {
  if (input.versions === undefined) {
    return undefined;
  }

  const remainingVersions = input.versions.filter(
    (version) => version.version !== input.result.version.version,
  );
  return [...remainingVersions, input.result.version].sort(
    (left, right) => left.version - right.version,
  );
}

export function applyCreatedSandboxProfileVersionDraftToVersions(input: {
  versions: readonly SandboxProfileVersion[] | undefined;
  draftVersion: SandboxProfileVersion;
}): readonly SandboxProfileVersion[] {
  const remainingVersions = (input.versions ?? []).filter(
    (version) => version.version !== input.draftVersion.version && version.state !== "draft",
  );
  return [...remainingVersions, input.draftVersion].sort(
    (left, right) => left.version - right.version,
  );
}

export function applyDiscardedSandboxProfileVersionDraftToVersions(input: {
  versions: readonly SandboxProfileVersion[] | undefined;
  discardedVersion: number;
}): readonly SandboxProfileVersion[] | undefined {
  if (input.versions === undefined) {
    return undefined;
  }

  return input.versions.filter((version) => version.version !== input.discardedVersion);
}

export function resolveSandboxProfileSetupScriptIntegrationRows(
  initialRows: readonly SandboxProfileBindingEditorRow[] | null,
  draftRows: readonly SandboxProfileBindingEditorRow[] | null | undefined,
): readonly SandboxProfileBindingEditorRow[] | null {
  return draftRows ?? initialRows;
}
