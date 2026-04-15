import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { useEffect, useReducer, useRef } from "react";

import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
  type AutoSaveErrorState,
} from "./auto-save-behavior.js";
import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { EditableHeading } from "./editable-heading.js";

type AutoSaveStatus = AutoSaveInputVisualStatus;

type EditableHeadingState = {
  isEditing: boolean;
  draftValue: string;
  errorState: AutoSaveErrorState | null;
  status: AutoSaveStatus;
};

type EditableHeadingAction =
  | {
      type: "sync-from-props";
      value: string;
      preserveStatus: boolean;
    }
  | {
      type: "apply-parent-save-error";
      message: string;
    }
  | {
      type: "change-draft";
      draftValue: string;
    }
  | {
      type: "enter-edit-mode";
      value: string;
    }
  | {
      type: "show-parent-save-error";
      errorMessage: string;
    }
  | {
      type: "cancel-edit";
      value: string;
    }
  | {
      type: "show-validation-error";
      message: string;
    }
  | {
      type: "start-saving";
    }
  | {
      type: "save-succeeded";
      value: string;
    }
  | {
      type: "save-failed";
      message: string;
    }
  | {
      type: "saved-fade-started";
    }
  | {
      type: "saved-fade-ended";
    };

function createEditableHeadingState(input: { value: string }): EditableHeadingState {
  return {
    isEditing: false,
    draftValue: input.value,
    errorState: null,
    status: "idle",
  };
}

function editableHeadingReducer(
  state: EditableHeadingState,
  action: EditableHeadingAction,
): EditableHeadingState {
  switch (action.type) {
    case "sync-from-props":
      if (action.preserveStatus) {
        return {
          ...state,
          draftValue: action.value,
          errorState: null,
        };
      }

      return createEditableHeadingState({
        value: action.value,
      });
    case "apply-parent-save-error":
      return {
        ...state,
        errorState: {
          kind: "save",
          message: action.message,
        },
        isEditing: true,
        status: "idle",
      };
    case "change-draft":
      return {
        ...state,
        draftValue: action.draftValue,
        errorState: null,
        status: "idle",
      };
    case "enter-edit-mode":
      return {
        ...state,
        draftValue: action.value,
        errorState: null,
        isEditing: true,
        status: "idle",
      };
    case "show-parent-save-error":
      return {
        ...state,
        errorState: {
          kind: "save",
          message: action.errorMessage,
        },
        isEditing: true,
        status: "idle",
      };
    case "cancel-edit":
      return {
        ...state,
        draftValue: action.value,
        errorState: null,
        isEditing: false,
        status: "idle",
      };
    case "show-validation-error":
      return {
        ...state,
        errorState: {
          kind: "validation",
          message: action.message,
        },
        status: "idle",
      };
    case "start-saving":
      return {
        ...state,
        errorState: null,
        status: "saving",
      };
    case "save-succeeded":
      return {
        ...state,
        draftValue: action.value,
        status: "saved",
      };
    case "save-failed":
      return {
        ...state,
        errorState: {
          kind: "save",
          message: action.message,
        },
        status: "idle",
      };
    case "saved-fade-started":
      return {
        ...state,
        status: "saved-fading",
      };
    case "saved-fade-ended":
      return {
        ...state,
        isEditing: false,
        status: "idle",
      };
  }
}

export type AutoSaveEditableHeadingProps = {
  value: string;
  displayText?: string;
  ariaLabel: string;
  editButtonLabel: string;
  disabled?: boolean;
  errorMessage?: string;
  placeholder?: string;
  maxWidthClassName?: string;
  headingTag?: "div" | "h1" | "h2";
  headingClassName?: string;
  inputClassName?: string;
  cancelOnEscape?: boolean;
  validate: (nextValue: string) => string | null;
  onSave: (nextValue: string) => Promise<void> | void;
  onEditStart?: () => void;
  successVisibleDurationMs?: number;
  successFadeDurationMs?: number;
  scheduler?: Scheduler;
};

export type AutoSaveTitleHeadingProps = Omit<
  AutoSaveEditableHeadingProps,
  "displayText" | "validate" | "value"
> & {
  emptyDisplayText: string;
  requiredLabel: string;
  value: string | null;
};

function useAutoSaveEditableHeadingState(input: AutoSaveEditableHeadingProps): {
  displayedHeadingValue: string;
  headingToneClassName: string;
  showStatus: boolean;
  state: EditableHeadingState;
  onChangeDraft: (nextValue: string) => void;
  onCommit: () => Promise<void>;
  onCancelEdit: () => void;
  onEnterEditMode: () => void;
} {
  const successVisibleDurationMs = input.successVisibleDurationMs ?? 2200;
  const successFadeDurationMs = input.successFadeDurationMs ?? 700;
  const scheduler = input.scheduler ?? systemScheduler;
  const errorMessage = input.errorMessage;
  const [state, dispatch] = useReducer(
    editableHeadingReducer,
    {
      value: input.value,
    },
    createEditableHeadingState,
  );
  const saveSequenceRef = useRef(0);
  const previousValueRef = useRef(input.value);
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = input.value;

    if (input.value === previousValue) {
      return;
    }

    const normalizedIncomingValue = input.value.trim();
    const normalizedDraftValue = state.draftValue.trim();
    const preserveStatus =
      (state.status === "saving" || state.status === "saved" || state.status === "saved-fading") &&
      normalizedIncomingValue === normalizedDraftValue;

    if (!preserveStatus) {
      saveSequenceRef.current += 1;
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler,
      });
    }

    dispatch({
      type: "sync-from-props",
      value: input.value,
      preserveStatus,
    });
  }, [input.value, scheduler, state.draftValue, state.status]);

  useEffect(() => {
    if (errorMessage === undefined) {
      return;
    }

    dispatch({
      type: "apply-parent-save-error",
      message: errorMessage,
    });
  }, [errorMessage]);

  useEffect(() => {
    return () => {
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler,
      });
    };
  }, [scheduler]);

  async function handleCommit(): Promise<void> {
    if (input.disabled === true || state.status === "saving") {
      return;
    }

    const normalizedDraftValue = state.draftValue.trim();
    if (normalizedDraftValue === input.value.trim()) {
      if (errorMessage !== undefined) {
        dispatch({
          type: "show-parent-save-error",
          errorMessage,
        });
        return;
      }

      dispatch({
        type: "cancel-edit",
        value: input.value,
      });
      return;
    }

    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });

    const validationMessage = input.validate(state.draftValue);
    if (validationMessage !== null) {
      dispatch({
        type: "show-validation-error",
        message: validationMessage,
      });
      return;
    }

    const currentSaveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = currentSaveSequence;
    dispatch({
      type: "start-saving",
    });

    try {
      await input.onSave(normalizedDraftValue);

      if (saveSequenceRef.current !== currentSaveSequence) {
        return;
      }

      dispatch({
        type: "save-succeeded",
        value: normalizedDraftValue,
      });
      scheduleSavedStateReset({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        onFadeEnd: () => {
          dispatch({
            type: "saved-fade-ended",
          });
        },
        onFadeStart: () => {
          dispatch({
            type: "saved-fade-started",
          });
        },
        scheduler,
        successFadeDurationMs,
        successVisibleDurationMs,
      });
    } catch (error) {
      if (saveSequenceRef.current !== currentSaveSequence) {
        return;
      }

      dispatch({
        type: "save-failed",
        message: getErrorMessage(error),
      });
    }
  }

  function handleDraftChange(nextValue: string): void {
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    dispatch({
      type: "change-draft",
      draftValue: nextValue,
    });
  }

  function handleCancelEdit(): void {
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    dispatch({
      type: "cancel-edit",
      value: input.value,
    });
  }

  function handleEnterEditMode(): void {
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    input.onEditStart?.();
    dispatch({
      type: "enter-edit-mode",
      value: input.value,
    });
  }

  return {
    displayedHeadingValue: input.displayText ?? input.value,
    headingToneClassName: state.errorState === null ? "" : " text-destructive",
    showStatus: state.status !== "idle" || state.errorState !== null,
    state,
    onChangeDraft: handleDraftChange,
    onCommit: handleCommit,
    onCancelEdit: handleCancelEdit,
    onEnterEditMode: handleEnterEditMode,
  };
}

export function AutoSaveEditableHeading(input: AutoSaveEditableHeadingProps): React.JSX.Element {
  const heading = useAutoSaveEditableHeadingState(input);
  const liveMessage =
    heading.state.errorState !== null
      ? ""
      : heading.state.status === "saving"
        ? "Saving"
        : heading.state.status === "saved" || heading.state.status === "saved-fading"
          ? "Saved"
          : "";

  return (
    <>
      <p aria-live="polite" className="sr-only" role="status">
        {liveMessage}
      </p>
      <EditableHeading
        ariaLabel={input.ariaLabel}
        draftValue={heading.state.draftValue}
        editButtonLabel={input.editButtonLabel}
        errorMessage={heading.state.errorState?.message}
        isEditing={heading.state.isEditing}
        maxWidthClassName={input.maxWidthClassName}
        onCancel={heading.onCancelEdit}
        onCommit={() => {
          void heading.onCommit();
        }}
        onDraftValueChange={heading.onChangeDraft}
        onEditStart={heading.onEnterEditMode}
        placeholder={input.placeholder}
        disabled={input.disabled === true || heading.state.status === "saving"}
        saveStatus={
          heading.showStatus && heading.state.errorState === null ? heading.state.status : "idle"
        }
        value={heading.displayedHeadingValue}
        {...(input.cancelOnEscape === undefined ? {} : { cancelOnEscape: input.cancelOnEscape })}
        {...(input.headingClassName === undefined
          ? {}
          : { headingClassName: input.headingClassName })}
        {...(input.headingTag === undefined ? {} : { headingTag: input.headingTag })}
        {...(input.inputClassName === undefined ? {} : { inputClassName: input.inputClassName })}
      />
    </>
  );
}

export function AutoSaveTitleHeading(input: AutoSaveTitleHeadingProps): React.JSX.Element {
  const { emptyDisplayText, requiredLabel, value, ...editableHeadingProps } = input;
  const normalizedValue = value === null || value.trim().length === 0 ? null : value;

  return (
    <AutoSaveEditableHeading
      displayText={normalizedValue ?? emptyDisplayText}
      validate={(nextValue) => {
        return nextValue.trim().length > 0 ? null : `${requiredLabel} is required.`;
      }}
      value={normalizedValue ?? ""}
      {...editableHeadingProps}
    />
  );
}
