import { Button, Input, Textarea } from "@mistle/ui";
import { useState } from "react";

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
    <div className="space-y-3 pb-4" role="region" aria-label="Pending server requests">
      {entries.map((entry) => {
        const requestKey = createRequestKey(entry.requestId);

        if (entry.kind === "command-approval") {
          return (
            <div className="space-y-3 rounded-xl border p-4" key={requestKey}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">Command approval</p>
                <p className="text-muted-foreground text-xs">{entry.method}</p>
              </div>
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
              <ApprovalDecisionButtons
                appearance="panel"
                availableDecisions={entry.availableDecisions}
                disabled={isRespondingToServerRequest}
                onRespondToServerRequest={onRespondToServerRequest}
                requestId={entry.requestId}
              />
              {entry.responseErrorMessage === null ? null : (
                <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
              )}
            </div>
          );
        }

        if (entry.kind === "file-change-approval") {
          return (
            <div className="space-y-3 rounded-xl border p-4" key={requestKey}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">File change approval</p>
                <p className="text-muted-foreground text-xs">{entry.method}</p>
              </div>
              {entry.reason === null ? null : (
                <p className="text-sm leading-6 whitespace-pre-wrap">{entry.reason}</p>
              )}
              {entry.grantRoot === null ? null : (
                <p className="text-muted-foreground text-xs">grant root: {entry.grantRoot}</p>
              )}
              <ApprovalDecisionButtons
                appearance="panel"
                availableDecisions={entry.availableDecisions}
                disabled={isRespondingToServerRequest}
                onRespondToServerRequest={onRespondToServerRequest}
                requestId={entry.requestId}
              />
              {entry.responseErrorMessage === null ? null : (
                <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
              )}
            </div>
          );
        }

        if (entry.kind === "tool-user-input") {
          return (
            <div className="space-y-4 rounded-xl border p-4" key={requestKey}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">User input requested</p>
                <p className="text-muted-foreground text-xs">{entry.method}</p>
              </div>
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
                              variant={selectedAnswer === option.label ? "default" : "outline"}
                            >
                              {option.label}
                            </Button>
                          ))}
                      </div>
                    )}
                    {otherOption === undefined ? null : otherOption.inputKind === "textarea" ? (
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
              <div className="flex items-center gap-2">
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
              </div>
              {entry.responseErrorMessage === null ? null : (
                <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
              )}
            </div>
          );
        }

        if (entry.kind === "opencode-permission") {
          return (
            <div className="space-y-3 rounded-xl border p-4" key={requestKey}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">OpenCode permission</p>
                <p className="text-muted-foreground text-xs">{entry.method}</p>
              </div>
              <p className="text-sm leading-6 whitespace-pre-wrap">
                {entry.permission}: {entry.patterns.join(", ")}
              </p>
              <ApprovalDecisionButtons
                appearance="panel"
                availableDecisions={entry.availableDecisions}
                disabled={isRespondingToServerRequest}
                onRespondToServerRequest={onRespondToServerRequest}
                requestId={entry.requestId}
              />
              {entry.responseErrorMessage === null ? null : (
                <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
              )}
            </div>
          );
        }

        if (entry.kind === "claude-code-permission") {
          return (
            <div className="space-y-3 rounded-xl border p-4" key={requestKey}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">Claude Code permission</p>
                <p className="text-muted-foreground text-xs">{entry.method}</p>
              </div>
              <p className="text-sm leading-6 whitespace-pre-wrap">{entry.toolName}</p>
              <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                {entry.toolInputJson}
              </pre>
              <ApprovalDecisionButtons
                appearance="panel"
                availableDecisions={entry.availableDecisions}
                disabled={isRespondingToServerRequest}
                onRespondToServerRequest={onRespondToServerRequest}
                requestId={entry.requestId}
              />
              {entry.responseErrorMessage === null ? null : (
                <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
              )}
            </div>
          );
        }

        if (entry.kind === "pi-extension-ui-confirm") {
          return (
            <div className="space-y-3 rounded-xl border p-4" key={requestKey}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">Pi confirmation</p>
                <p className="text-muted-foreground text-xs">{entry.method}</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium text-sm">{entry.title}</p>
                <p className="text-sm leading-6 whitespace-pre-wrap">{entry.message}</p>
              </div>
              <ApprovalDecisionButtons
                appearance="panel"
                availableDecisions={entry.availableDecisions}
                disabled={isRespondingToServerRequest}
                onRespondToServerRequest={onRespondToServerRequest}
                requestId={entry.requestId}
              />
              {entry.responseErrorMessage === null ? null : (
                <p className="text-destructive text-sm">{entry.responseErrorMessage}</p>
              )}
            </div>
          );
        }

        return assertUnsupportedServerRequestEntry(entry);
      })}
    </div>
  );
}

export type { ServerRequestsPanelProps };
