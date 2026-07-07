import {
  readBrowserStorageJson,
  removeBrowserStorageItem,
  writeBrowserStorageJson,
  type BrowserStorage,
} from "../shared/browser-storage.js";
import { isRecord } from "../shared/is-record.js";

const DesignerLandingPromptQueryParameterName = "prompt";
export const DesignerLandingPromptHandoffStorageKey = "mistle:designer:landing-prompt-handoff";
export const DesignerLandingPromptHandoffTtlMs = 30 * 60 * 1000;
const DesignerLandingPromptMaxLength = 20_000;

export type DesignerLandingPromptHandoff = {
  expiresAtMs: number;
  idempotencyKey: string;
  prompt: string;
};

type DesignerLandingPromptCaptureResult =
  | {
      kind: "captured";
      sanitizedSearch: string;
    }
  | {
      kind: "ignored-invalid-prompt";
      sanitizedSearch: string;
    }
  | {
      kind: "no-prompt";
    }
  | {
      kind: "not-root-route";
    }
  | {
      kind: "storage-blocked";
      prompt: string;
      sanitizedSearch: string;
    };

export function captureDesignerLandingPromptHandoff(input: {
  createIdempotencyKey: () => string;
  nowMs: number;
  pathname: string;
  search: string;
  storage: BrowserStorage | null;
}): DesignerLandingPromptCaptureResult {
  if (input.pathname !== "/") {
    return { kind: "not-root-route" };
  }

  const searchParams = new URLSearchParams(input.search);
  const rawPrompt = searchParams.get(DesignerLandingPromptQueryParameterName);
  if (rawPrompt === null) {
    return { kind: "no-prompt" };
  }

  searchParams.delete(DesignerLandingPromptQueryParameterName);
  const sanitizedSearch = createSearchString(searchParams);
  const prompt = rawPrompt.trim();
  if (prompt.length === 0 || prompt.length > DesignerLandingPromptMaxLength) {
    return {
      kind: "ignored-invalid-prompt",
      sanitizedSearch,
    };
  }

  const handoff = {
    expiresAtMs: input.nowMs + DesignerLandingPromptHandoffTtlMs,
    idempotencyKey: input.createIdempotencyKey(),
    prompt,
  } satisfies DesignerLandingPromptHandoff;

  const didWrite = writeBrowserStorageJson({
    key: DesignerLandingPromptHandoffStorageKey,
    storage: input.storage,
    value: handoff,
  });
  if (!didWrite) {
    return {
      kind: "storage-blocked",
      prompt,
      sanitizedSearch,
    };
  }

  return {
    kind: "captured",
    sanitizedSearch,
  };
}

export function readPendingDesignerLandingPromptHandoff(input: {
  nowMs: number;
  storage: BrowserStorage | null;
}): DesignerLandingPromptHandoff | null {
  const handoff = readBrowserStorageJson({
    key: DesignerLandingPromptHandoffStorageKey,
    storage: input.storage,
    isValue: isDesignerLandingPromptHandoff,
  });
  if (handoff === null) {
    return null;
  }

  if (handoff.expiresAtMs <= input.nowMs) {
    clearPendingDesignerLandingPromptHandoff({
      storage: input.storage,
    });
    return null;
  }

  return handoff;
}

export function clearPendingDesignerLandingPromptHandoff(input: {
  storage: Pick<BrowserStorage, "removeItem"> | null;
}): void {
  removeBrowserStorageItem({
    key: DesignerLandingPromptHandoffStorageKey,
    storage: input.storage,
  });
}

function createSearchString(searchParams: URLSearchParams): string {
  const serializedSearch = searchParams.toString();
  return serializedSearch.length === 0 ? "" : `?${serializedSearch}`;
}

function isDesignerLandingPromptHandoff(value: unknown): value is DesignerLandingPromptHandoff {
  if (!isRecord(value)) {
    return false;
  }

  const expiresAtMs = Reflect.get(value, "expiresAtMs");
  const idempotencyKey = Reflect.get(value, "idempotencyKey");
  const prompt = Reflect.get(value, "prompt");

  return (
    typeof expiresAtMs === "number" &&
    Number.isFinite(expiresAtMs) &&
    typeof idempotencyKey === "string" &&
    idempotencyKey.length > 0 &&
    idempotencyKey.length <= 255 &&
    typeof prompt === "string" &&
    prompt.trim().length > 0 &&
    prompt.length <= DesignerLandingPromptMaxLength
  );
}
