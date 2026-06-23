import { Button, cn, Input, Textarea } from "@mistle/ui";
import { useState, type Dispatch, type SetStateAction } from "react";

import {
  ComposerActionPanel,
  ComposerActionPanelStack,
} from "../../shared/composer-action-panel.js";
import { ApprovalDecisionButtons } from "./approval-decision-buttons.js";
import type { ServerRequestEntry } from "./server-request-entries.js";

type ServerRequestsPanelProps = {
  entries: readonly ServerRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

type ToolUserInputQuestion = Extract<
  ServerRequestEntry,
  { kind: "tool-user-input" }
>["questions"][number];
type ToolUserInputOption = ToolUserInputQuestion["options"][number];

const CompactOptionLabelMaxLength = 32;

function createRequestKey(requestId: string | number): string {
  return String(requestId);
}

function assertUnsupportedServerRequestEntry(_entry: never): never {
  throw new Error("Unsupported server request entry.");
}

function readUserInputAnswer(input: {
  answerKey: string;
  otherOption: ToolUserInputOption | undefined;
  userInputAnswers: Readonly<Record<string, string>>;
}): string {
  return input.userInputAnswers[input.answerKey] ?? input.otherOption?.defaultValue ?? "";
}

function canSubmitUserInputOnOptionSelect(
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>,
): boolean {
  return (
    entry.questions.length === 1 &&
    entry.questions[0] !== undefined &&
    entry.questions[0].options.some((option) => !option.isOther) &&
    entry.questions[0].options.every((option) => !option.isOther)
  );
}

function createUserInputResponse(input: {
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  requestKey: string;
  selectedAnswer?: { questionId: string; value: string };
  userInputAnswers: Readonly<Record<string, string>>;
}): { answers: { id: string; value: string }[] } {
  return {
    answers: input.entry.questions.map((question) => {
      if (input.selectedAnswer?.questionId === question.id) {
        return {
          id: question.id,
          value: input.selectedAnswer.value,
        };
      }

      const answerKey = `${input.requestKey}:${question.id}`;
      const otherOption = question.options.find((option) => option.isOther);
      return {
        id: question.id,
        value: readUserInputAnswer({
          answerKey,
          otherOption,
          userInputAnswers: input.userInputAnswers,
        }),
      };
    }),
  };
}

function shouldRenderOptionRows(options: readonly ToolUserInputOption[]): boolean {
  return options.some(
    (option) =>
      !option.isOther &&
      (option.description !== null || option.label.length > CompactOptionLabelMaxLength),
  );
}

function createUserInputPanelTitle(
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>,
): string {
  const firstQuestion = entry.questions[0];
  if (
    entry.questions.length === 1 &&
    firstQuestion !== undefined &&
    firstQuestion.header !== null
  ) {
    return firstQuestion.header;
  }

  return "Input needed";
}

function UserInputOptions(input: {
  answerKey: string;
  disabled: boolean;
  onSelectOption: (option: ToolUserInputOption) => void;
  options: readonly ToolUserInputOption[];
  selectedAnswer: string;
  setUserInputAnswers: Dispatch<SetStateAction<Record<string, string>>>;
}): React.JSX.Element | null {
  const selectableOptions = input.options.filter((option) => !option.isOther);
  if (selectableOptions.length === 0) {
    return null;
  }

  if (!shouldRenderOptionRows(selectableOptions)) {
    return (
      <div className="flex flex-wrap gap-2">
        {selectableOptions.map((option) => (
          <Button
            disabled={input.disabled}
            key={option.label}
            onClick={() => {
              input.setUserInputAnswers((current) => ({
                ...current,
                [input.answerKey]: option.label,
              }));
              input.onSelectOption(option);
            }}
            type="button"
            variant={input.selectedAnswer === option.label ? "default" : "outline"}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y overflow-hidden rounded-md border">
      {selectableOptions.map((option, index) => {
        const isSelected = input.selectedAnswer === option.label;

        return (
          <button
            aria-pressed={isSelected}
            className={cn(
              "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              isSelected ? "bg-muted" : "bg-background hover:bg-muted/60",
            )}
            disabled={input.disabled}
            key={`${option.label}:${String(index)}`}
            onClick={() => {
              input.setUserInputAnswers((current) => ({
                ...current,
                [input.answerKey]: option.label,
              }));
              input.onSelectOption(option);
            }}
            type="button"
          >
            <span
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block text-sm leading-5 font-medium text-foreground">
                {option.label}
              </span>
              {option.description === null ? null : (
                <span className="text-muted-foreground block text-xs leading-5">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ServerRequestsPanel({
  entries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: ServerRequestsPanelProps): React.JSX.Element | null {
  const [userInputAnswers, setUserInputAnswers] = useState<Record<string, string>>({});

  if (entries.length === 0) {
    return null;
  }

  return (
    <div role="region" aria-label="Pending server requests">
      <ComposerActionPanelStack>
        {entries.map((entry) => {
          const requestKey = createRequestKey(entry.requestId);

          if (entry.kind === "command-approval") {
            return (
              <ComposerActionPanel
                actions={
                  <ApprovalDecisionButtons
                    appearance="panel"
                    availableDecisions={entry.availableDecisions}
                    disabled={isRespondingToServerRequest}
                    onRespondToServerRequest={onRespondToServerRequest}
                    requestId={entry.requestId}
                  />
                }
                details={
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">{entry.method}</p>
                    {entry.reason === null ? null : (
                      <p className="text-sm leading-6 whitespace-pre-wrap">{entry.reason}</p>
                    )}
                    <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                      {entry.command ?? "Command unavailable"}
                    </pre>
                    {entry.cwd === null ? null : (
                      <p className="text-muted-foreground text-xs">cwd: {entry.cwd}</p>
                    )}
                    {entry.networkHost === null ? null : (
                      <p className="text-muted-foreground text-xs">
                        network: {entry.networkProtocol ?? "unknown"}://{entry.networkHost}
                        {entry.networkPort === null ? null : `:${entry.networkPort}`}
                      </p>
                    )}
                    {entry.responseErrorMessage === null ? null : (
                      <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
                    )}
                  </div>
                }
                key={requestKey}
                title="Command approval"
              />
            );
          }

          if (entry.kind === "file-change-approval") {
            return (
              <ComposerActionPanel
                actions={
                  <ApprovalDecisionButtons
                    appearance="panel"
                    availableDecisions={entry.availableDecisions}
                    disabled={isRespondingToServerRequest}
                    onRespondToServerRequest={onRespondToServerRequest}
                    requestId={entry.requestId}
                  />
                }
                details={
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">{entry.method}</p>
                    {entry.reason === null ? null : (
                      <p className="text-sm leading-6 whitespace-pre-wrap">{entry.reason}</p>
                    )}
                    {entry.grantRoot === null ? null : (
                      <p className="text-muted-foreground text-xs">grant root: {entry.grantRoot}</p>
                    )}
                    {entry.responseErrorMessage === null ? null : (
                      <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
                    )}
                  </div>
                }
                key={requestKey}
                title="File change approval"
              />
            );
          }

          if (entry.kind === "tool-user-input") {
            const submitOnOptionSelect = canSubmitUserInputOnOptionSelect(entry);

            return (
              <ComposerActionPanel
                actions={
                  submitOnOptionSelect ? null : (
                    <Button
                      disabled={
                        isRespondingToServerRequest ||
                        entry.questions.some((question) => {
                          const answerKey = `${requestKey}:${question.id}`;
                          const otherOption = question.options.find((option) => option.isOther);
                          return (
                            readUserInputAnswer({
                              answerKey,
                              otherOption,
                              userInputAnswers,
                            }).trim().length === 0
                          );
                        })
                      }
                      onClick={() => {
                        onRespondToServerRequest(
                          entry.requestId,
                          createUserInputResponse({
                            entry,
                            requestKey,
                            userInputAnswers,
                          }),
                        );
                      }}
                      type="button"
                    >
                      Submit responses
                    </Button>
                  )
                }
                details={
                  <div className="space-y-3">
                    {entry.questions.map((question) => {
                      const answerKey = `${requestKey}:${question.id}`;
                      const otherOption = question.options.find((option) => option.isOther);
                      const selectedAnswer = readUserInputAnswer({
                        answerKey,
                        otherOption,
                        userInputAnswers,
                      });

                      return (
                        <div className="space-y-2" key={question.id}>
                          {entry.questions.length === 1 || question.header === null ? null : (
                            <p className="text-muted-foreground text-xs font-medium">
                              {question.header}
                            </p>
                          )}
                          <p className="text-muted-foreground text-sm leading-5">
                            {question.question}
                          </p>
                          <UserInputOptions
                            answerKey={answerKey}
                            disabled={isRespondingToServerRequest}
                            onSelectOption={(option) => {
                              if (!submitOnOptionSelect) {
                                return;
                              }

                              onRespondToServerRequest(
                                entry.requestId,
                                createUserInputResponse({
                                  entry,
                                  requestKey,
                                  selectedAnswer: {
                                    questionId: question.id,
                                    value: option.label,
                                  },
                                  userInputAnswers,
                                }),
                              );
                            }}
                            options={question.options}
                            selectedAnswer={selectedAnswer}
                            setUserInputAnswers={setUserInputAnswers}
                          />
                          {otherOption === undefined ? null : otherOption.inputKind ===
                            "textarea" ? (
                            <Textarea
                              className="min-h-32"
                              disabled={isRespondingToServerRequest}
                              onChange={(event) => {
                                setUserInputAnswers((current) => ({
                                  ...current,
                                  [answerKey]: event.target.value,
                                }));
                              }}
                              placeholder={otherOption.label}
                              value={selectedAnswer}
                            />
                          ) : (
                            <Input
                              disabled={isRespondingToServerRequest}
                              onChange={(event) => {
                                setUserInputAnswers((current) => ({
                                  ...current,
                                  [answerKey]: event.target.value,
                                }));
                              }}
                              placeholder={otherOption.label}
                              value={selectedAnswer}
                            />
                          )}
                        </div>
                      );
                    })}
                    {entry.responseErrorMessage === null ? null : (
                      <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
                    )}
                  </div>
                }
                key={requestKey}
                title={createUserInputPanelTitle(entry)}
              />
            );
          }

          if (entry.kind === "opencode-permission") {
            return (
              <ComposerActionPanel
                actions={
                  <ApprovalDecisionButtons
                    appearance="panel"
                    availableDecisions={entry.availableDecisions}
                    disabled={isRespondingToServerRequest}
                    onRespondToServerRequest={onRespondToServerRequest}
                    requestId={entry.requestId}
                  />
                }
                details={
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">{entry.method}</p>
                    <p className="text-sm leading-6 whitespace-pre-wrap">
                      {entry.permission}: {entry.patterns.join(", ")}
                    </p>
                    {entry.responseErrorMessage === null ? null : (
                      <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
                    )}
                  </div>
                }
                key={requestKey}
                title="OpenCode permission"
              />
            );
          }

          if (entry.kind === "claude-code-permission") {
            return (
              <ComposerActionPanel
                actions={
                  <ApprovalDecisionButtons
                    appearance="panel"
                    availableDecisions={entry.availableDecisions}
                    disabled={isRespondingToServerRequest}
                    onRespondToServerRequest={onRespondToServerRequest}
                    requestId={entry.requestId}
                  />
                }
                details={
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">{entry.method}</p>
                    <p className="text-sm leading-6 whitespace-pre-wrap">{entry.toolName}</p>
                    <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                      {entry.toolInputJson}
                    </pre>
                    {entry.responseErrorMessage === null ? null : (
                      <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
                    )}
                  </div>
                }
                key={requestKey}
                title="Claude Code permission"
              />
            );
          }

          if (entry.kind === "pi-extension-ui-confirm") {
            return (
              <ComposerActionPanel
                actions={
                  <ApprovalDecisionButtons
                    appearance="panel"
                    availableDecisions={entry.availableDecisions}
                    disabled={isRespondingToServerRequest}
                    onRespondToServerRequest={onRespondToServerRequest}
                    requestId={entry.requestId}
                  />
                }
                details={
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">{entry.method}</p>
                    <div className="space-y-1">
                      <p className="font-medium text-sm">{entry.title}</p>
                      <p className="text-sm leading-6 whitespace-pre-wrap">{entry.message}</p>
                    </div>
                    {entry.responseErrorMessage === null ? null : (
                      <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
                    )}
                  </div>
                }
                key={requestKey}
                title="Pi confirmation"
              />
            );
          }

          return assertUnsupportedServerRequestEntry(entry);
        })}
      </ComposerActionPanelStack>
    </div>
  );
}

export type { ServerRequestsPanelProps };
