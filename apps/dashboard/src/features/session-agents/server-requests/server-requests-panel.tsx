import { Button, Input, Textarea } from "@mistle/ui";
import { useState } from "react";

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

function createRequestKey(requestId: string | number): string {
  return String(requestId);
}

function assertUnsupportedServerRequestEntry(_entry: never): never {
  throw new Error("Unsupported server request entry.");
}

function readUserInputAnswer(input: {
  answerKey: string;
  otherOption:
    | Extract<
        ServerRequestEntry,
        { kind: "tool-user-input" }
      >["questions"][number]["options"][number]
    | undefined;
  userInputAnswers: Readonly<Record<string, string>>;
}): string {
  return input.userInputAnswers[input.answerKey] ?? input.otherOption?.defaultValue ?? "";
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
            return (
              <ComposerActionPanel
                actions={
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
                      onRespondToServerRequest(entry.requestId, {
                        answers: entry.questions.map((question) => {
                          const answerKey = `${requestKey}:${question.id}`;
                          const otherOption = question.options.find((option) => option.isOther);
                          return {
                            id: question.id,
                            value: readUserInputAnswer({
                              answerKey,
                              otherOption,
                              userInputAnswers,
                            }),
                          };
                        }),
                      });
                    }}
                    type="button"
                  >
                    Submit responses
                  </Button>
                }
                details={
                  <div className="space-y-4">
                    <p className="text-muted-foreground text-xs">{entry.method}</p>
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
                          {question.header === null ? null : (
                            <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
                              {question.header}
                            </p>
                          )}
                          <p className="text-sm leading-6">{question.question}</p>
                          {question.options.length === 0 ? null : (
                            <div className="flex flex-wrap gap-2">
                              {question.options
                                .filter((option) => !option.isOther)
                                .map((option) => (
                                  <Button
                                    disabled={isRespondingToServerRequest}
                                    key={option.label}
                                    onClick={() => {
                                      setUserInputAnswers((current) => ({
                                        ...current,
                                        [answerKey]: option.label,
                                      }));
                                    }}
                                    type="button"
                                    variant={
                                      selectedAnswer === option.label ? "default" : "outline"
                                    }
                                  >
                                    {option.label}
                                  </Button>
                                ))}
                            </div>
                          )}
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
                title="User input requested"
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
