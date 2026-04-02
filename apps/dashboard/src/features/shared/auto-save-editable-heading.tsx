import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { Button, Notice } from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useReducer, useRef } from "react";

import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
  type AutoSaveErrorState,
} from "./auto-save-behavior.js";
import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { PageTitleField } from "./page-title-field.js";

type AutoSaveStatus = AutoSaveInputVisualStatus;

type EditableHeadingState = {
  isEditing: boolean;
  draftValue: string;
  value: string;
  errorState: AutoSaveErrorState | null;
  status: AutoSaveStatus;
};

type EditableHeadingAction =
  | {
      type: "reset-from-props";
      savedValue: string;
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
    }
  | {
      type: "show-parent-save-error";
      saveError: string;
    }
  | {
      type: "cancel-edit";
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

function createEditableHeadingState(input: { savedValue: string }): EditableHeadingState {
  return {
    isEditing: false,
    draftValue: input.savedValue,
    value: input.savedValue,
    errorState: null,
    status: "idle",
  };
}

function editableHeadingReducer(
  state: EditableHeadingState,
  action: EditableHeadingAction,
): EditableHeadingState {
  switch (action.type) {
    case "reset-from-props":
      return createEditableHeadingState({
        savedValue: action.savedValue,
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
        draftValue: state.value,
        errorState: null,
        isEditing: true,
        status: "idle",
      };
    case "show-parent-save-error":
      return {
        ...state,
        draftValue: state.value,
        errorState: {
          kind: "save",
          message: action.saveError,
        },
        isEditing: true,
        status: "idle",
      };
    case "cancel-edit":
      return {
        ...state,
        draftValue: state.value,
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
        value: action.value,
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
  savedValue: string;
  displayText?: string;
  ariaLabel: string;
  editButtonLabel: string;
  disabled?: boolean;
  saveError?: string;
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
  const saveError = input.saveError;
  const [state, dispatch] = useReducer(
    editableHeadingReducer,
    {
      savedValue: input.savedValue,
    },
    createEditableHeadingState,
  );
  const saveSequenceRef = useRef(0);
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    saveSequenceRef.current += 1;
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    dispatch({
      type: "reset-from-props",
      savedValue: input.savedValue,
    });
  }, [input.savedValue, scheduler]);

  useEffect(() => {
    if (saveError === undefined) {
      return;
    }

    dispatch({
      type: "apply-parent-save-error",
      message: saveError,
    });
  }, [saveError]);

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
    if (normalizedDraftValue === state.value.trim()) {
      if (saveError !== undefined) {
        dispatch({
          type: "show-parent-save-error",
          saveError,
        });
        return;
      }

      dispatch({
        type: "cancel-edit",
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
    });
  }

  return {
    displayedHeadingValue: input.displayText ?? state.value,
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
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;
  const HeadingTag = input.headingTag ?? "h1";
  const headingClassName = input.headingClassName ?? "text-xl font-semibold leading-none";

  if (heading.state.isEditing) {
    return (
      <PageTitleField
        ariaLabel={input.ariaLabel}
        autoFocus={true}
        fieldId="editable-heading-input"
        label={input.ariaLabel}
        disabled={input.disabled === true || heading.state.status === "saving"}
        onBlur={() => {
          void heading.onCommit();
        }}
        onChange={heading.onChangeDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
            return;
          }

          if (event.key === "Escape" && (input.cancelOnEscape ?? true)) {
            heading.onCancelEdit();
          }
        }}
        saveStatus={
          heading.showStatus && heading.state.errorState === null ? heading.state.status : "idle"
        }
        showLabel={false}
        value={heading.state.draftValue}
        {...(input.inputClassName === undefined ? {} : { className: input.inputClassName })}
        {...(heading.state.errorState === null
          ? {}
          : { errorMessage: heading.state.errorState.message })}
        {...(input.maxWidthClassName === undefined
          ? {}
          : { maxWidthClassName: input.maxWidthClassName })}
        {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
      />
    );
  }

  return (
    <div className={containerClassName}>
      <div className="flex max-w-full items-center gap-1">
        <HeadingTag className={`min-w-0 ${headingClassName}${heading.headingToneClassName}`}>
          {heading.displayedHeadingValue}
        </HeadingTag>
        <Button
          aria-label={input.editButtonLabel}
          disabled={input.disabled === true || heading.state.status === "saving"}
          onClick={heading.onEnterEditMode}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PencilSimpleIcon aria-hidden className="size-4" />
        </Button>
      </div>
      {heading.state.errorState === null ? null : (
        <Notice variant="alert">{heading.state.errorState.message}</Notice>
      )}
    </div>
  );
}
