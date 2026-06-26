import { Button, cn, Input, Textarea } from "@mistle/ui";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useState, type Dispatch, type SetStateAction } from "react";

import { resolveApiErrorMessage } from "../../api/error-message.js";
import { readHttpErrorCode } from "../../api/http-api-error.js";
import {
  IntegrationConnectionResourcePickerView,
  toIntegrationConnectionResourcePickerItems,
} from "../../forms/integration-connection-resource-picker-view.js";
import type { IntegrationResourceListViewState } from "../../forms/integration-resource-picker-view-model.js";
import {
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../../integrations/integrations-service.js";
import { sandboxProfileIntegrationDirectoryQueryKey } from "../../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  ComposerActionPanel,
  ComposerActionPanelStack,
} from "../../shared/composer-action-panel.js";
import { ApprovalDecisionButtons } from "./approval-decision-buttons.js";
import type { ServerRequestEntry } from "./server-request-entries.js";
import {
  submitServerRequestResponse,
  type RespondToServerRequest,
} from "./server-request-response.js";

type ServerRequestsPanelProps = {
  entries: readonly ServerRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: RespondToServerRequest;
};

type ToolUserInputQuestion = Extract<
  ServerRequestEntry,
  { kind: "tool-user-input" }
>["questions"][number];
type ToolUserInputOption = NonNullable<ToolUserInputQuestion["options"]>[number];
type UserInputAnswerValue = string | readonly string[];
type ResourceSelectionQuestion = ToolUserInputQuestion & {
  inputKind: "integrationConnectionResourceMultiSelect";
  resourceSelection: NonNullable<ToolUserInputQuestion["resourceSelection"]>;
};
type IntegrationConnectionResourcesResult = Awaited<
  ReturnType<typeof listIntegrationConnectionResources>
>;
type ResourceRefreshState = {
  error: unknown;
  hasStartedSync: boolean;
  isPending: boolean;
};
type ResourceSelectionQuestionViewState = {
  canSubmit: boolean;
  isRefreshing: boolean;
  listState: IntegrationResourceListViewState;
  onRefresh: () => void;
  refreshErrorMessage: string | null;
  search: string;
  setSearch: (search: string) => void;
  unavailableSelectedValues: readonly string[];
  visibleItems: IntegrationConnectionResourcesResult["items"];
};
type ResourceSelectionRefetchQuery = {
  state: {
    data: IntegrationConnectionResourcesResult | undefined;
    error: unknown;
  };
};

const ResourceSearchDebounceMs = 300;
const ResourceSyncRefetchIntervalMs = 3_000;
const ResourceSyncInProgressCode = "RESOURCE_SYNC_IN_PROGRESS";

function createRequestKey(requestId: string | number): string {
  return String(requestId);
}

function assertUnsupportedServerRequestEntry(_entry: never): never {
  throw new Error("Unsupported server request entry.");
}

function readUserInputAnswer(input: {
  answerKey: string;
  otherOption: ToolUserInputOption | undefined;
  userInputAnswers: Readonly<Record<string, UserInputAnswerValue>>;
}): string {
  const answer = input.userInputAnswers[input.answerKey];
  return typeof answer === "string" ? answer : (input.otherOption?.defaultValue ?? "");
}

function readResourceSelectionAnswer(input: {
  answerKey: string;
  question: ToolUserInputQuestion;
  userInputAnswers: Readonly<Record<string, UserInputAnswerValue>>;
}): readonly string[] {
  const answer = input.userInputAnswers[input.answerKey];
  if (Array.isArray(answer)) {
    return answer;
  }

  return input.question.resourceSelection?.initialSelectedHandles ?? [];
}

function isResourceSelectionQuestion(
  question: ToolUserInputQuestion,
): question is ResourceSelectionQuestion {
  return (
    question.inputKind === "integrationConnectionResourceMultiSelect" &&
    question.resourceSelection !== undefined
  );
}

function canSubmitUserInputOnOptionSelect(
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>,
): boolean {
  return (
    entry.questions.length === 1 &&
    entry.questions[0] !== undefined &&
    entry.questions[0].options !== undefined &&
    entry.questions[0].options.some((option) => !option.isOther) &&
    entry.questions[0].options.every((option) => !option.isOther)
  );
}

function createUserInputResponse(input: {
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  requestKey: string;
  selectedAnswer?: { questionId: string; value: string };
  userInputAnswers: Readonly<Record<string, UserInputAnswerValue>>;
}): { answers: { id: string; value: string | string[] }[] } {
  return {
    answers: input.entry.questions.map((question) => {
      if (input.selectedAnswer?.questionId === question.id) {
        return {
          id: question.id,
          value: input.selectedAnswer.value,
        };
      }

      const answerKey = `${input.requestKey}:${question.id}`;
      if (question.inputKind === "integrationConnectionResourceMultiSelect") {
        return {
          id: question.id,
          value: [
            ...readResourceSelectionAnswer({
              answerKey,
              question,
              userInputAnswers: input.userInputAnswers,
            }),
          ],
        };
      }

      const otherOption = question.options?.find((option) => option.isOther);
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

function createUserInputCancelResponse(): { decision: "cancel" } {
  return { decision: "cancel" };
}

export function shouldPollResourceSelectionQuery(input: {
  data: IntegrationConnectionResourcesResult | undefined;
  error: unknown;
  refreshHasStartedSync: boolean;
}): boolean {
  if (input.data !== undefined) {
    return input.data.syncState === "syncing";
  }

  if (readHttpErrorCode(input.error) === ResourceSyncInProgressCode) {
    return true;
  }

  return input.refreshHasStartedSync;
}

function resolveResourceSelectionRefetchInterval(input: {
  query: ResourceSelectionRefetchQuery;
  refreshHasStartedSync: boolean;
}): false | number {
  return shouldPollResourceSelectionQuery({
    data: input.query.state.data,
    error: input.query.state.error,
    refreshHasStartedSync: input.refreshHasStartedSync,
  })
    ? ResourceSyncRefetchIntervalMs
    : false;
}

function createResourceQueryKey(input: {
  connectionId: string;
  resourceKind: string;
  search: string;
}): readonly ["integration-connections", string, "resources", string, string] {
  return [
    "integration-connections",
    input.connectionId,
    "resources",
    input.resourceKind,
    input.search,
  ];
}

function emptyResourceRefreshState(): ResourceRefreshState {
  return {
    error: null,
    hasStartedSync: false,
    isPending: false,
  };
}

function UserInputOptions(input: {
  answerKey: string;
  disabled: boolean;
  onSelectOption: (option: ToolUserInputOption) => void;
  options: readonly ToolUserInputOption[];
  selectedAnswer: string;
  setUserInputAnswers: Dispatch<SetStateAction<Record<string, UserInputAnswerValue>>>;
}): React.JSX.Element | null {
  const selectableOptions = input.options.filter((option) => !option.isOther);
  if (selectableOptions.length === 0) {
    return null;
  }

  return (
    <div className="divide-border/60 mx-4 divide-y">
      {selectableOptions.map((option, index) => {
        const isSelected = input.selectedAnswer === option.label;

        return (
          <button
            aria-pressed={isSelected}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className="block min-w-0 text-sm leading-5 font-medium text-foreground">
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function IntegrationConnectionResourceMultiSelectQuestion(input: {
  answerKey: string;
  disabled: boolean;
  question: ToolUserInputQuestion;
  selectedValues: readonly string[];
  state: ResourceSelectionQuestionViewState;
  setUserInputAnswers: Dispatch<SetStateAction<Record<string, UserInputAnswerValue>>>;
}): React.JSX.Element {
  if (input.question.resourceSelection === undefined) {
    throw new Error("Resource selection question requires resourceSelection.");
  }

  const resourceSelection = input.question.resourceSelection;
  const refreshLabel = `Refresh ${resourceSelection.resourceLabelPlural}`;

  return (
    <div className="mx-4">
      <IntegrationConnectionResourcePickerView
        density="compact"
        disabled={input.disabled}
        emptyMessage={
          resourceSelection.emptyMessage ??
          `No ${resourceSelection.resourceLabelPlural} available for this connection.`
        }
        id={input.answerKey}
        isRefreshing={input.state.isRefreshing}
        label={input.question.question}
        listState={input.state.listState}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={input.state.onRefresh}
        onSearchChange={input.state.setSearch}
        onSelectionChange={(nextValues) => {
          input.setUserInputAnswers((current) => ({
            ...current,
            [input.answerKey]: [...nextValues],
          }));
        }}
        refreshErrorMessage={input.state.refreshErrorMessage}
        refreshLabel={refreshLabel}
        refreshTooltip={refreshLabel}
        resourceLabelPlural={resourceSelection.resourceLabelPlural}
        search={input.state.search}
        searchPlaceholder={
          resourceSelection.searchPlaceholder ?? `Search ${resourceSelection.resourceLabelPlural}`
        }
        selectedValues={input.selectedValues}
        unavailableSelectedValues={input.state.unavailableSelectedValues}
        visibleItems={toIntegrationConnectionResourcePickerItems(input.state.visibleItems)}
      />
    </div>
  );
}

function useResourceSelectionQuestionStates(input: {
  disabled: boolean;
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  requestKey: string;
  selectedValuesByAnswerKey: Readonly<Record<string, readonly string[]>>;
}): Readonly<Record<string, ResourceSelectionQuestionViewState>> {
  const queryClient = useQueryClient();
  const [searchByAnswerKey, setSearchByAnswerKey] = useState<Record<string, string>>({});
  const [debouncedSearchByAnswerKey] = useDebouncedValue(searchByAnswerKey, {
    wait: ResourceSearchDebounceMs,
  });
  const [refreshStateByAnswerKey, setRefreshStateByAnswerKey] = useState<
    Record<string, ResourceRefreshState>
  >({});
  const resourceQuestions = input.entry.questions
    .filter(isResourceSelectionQuestion)
    .map((question) => {
      const answerKey = `${input.requestKey}:${question.id}`;
      return {
        answerKey,
        question,
        search: searchByAnswerKey[answerKey] ?? "",
        debouncedSearch: debouncedSearchByAnswerKey[answerKey] ?? "",
        refreshState: refreshStateByAnswerKey[answerKey] ?? emptyResourceRefreshState(),
      };
    });

  const resourceQueries = useQueries({
    queries: resourceQuestions.map((resourceQuestion) => ({
      queryKey: createResourceQueryKey({
        connectionId: resourceQuestion.question.resourceSelection.connectionId,
        resourceKind: resourceQuestion.question.resourceSelection.resourceKind,
        search: resourceQuestion.debouncedSearch,
      }),
      queryFn: async ({ signal }) =>
        listIntegrationConnectionResources({
          connectionId: resourceQuestion.question.resourceSelection.connectionId,
          kind: resourceQuestion.question.resourceSelection.resourceKind,
          ...(resourceQuestion.debouncedSearch.length === 0
            ? {}
            : { search: resourceQuestion.debouncedSearch }),
          signal,
        }),
      refetchInterval: (query: ResourceSelectionRefetchQuery) =>
        resolveResourceSelectionRefetchInterval({
          query,
          refreshHasStartedSync: resourceQuestion.refreshState.hasStartedSync,
        }),
      retry: false,
    })),
  });
  const availabilityQueries = useQueries({
    queries: resourceQuestions.map((resourceQuestion) => ({
      queryKey: createResourceQueryKey({
        connectionId: resourceQuestion.question.resourceSelection.connectionId,
        resourceKind: resourceQuestion.question.resourceSelection.resourceKind,
        search: "",
      }),
      queryFn: async ({ signal }) =>
        listIntegrationConnectionResources({
          connectionId: resourceQuestion.question.resourceSelection.connectionId,
          kind: resourceQuestion.question.resourceSelection.resourceKind,
          signal,
        }),
      enabled: resourceQuestion.debouncedSearch.length > 0,
      refetchInterval: (query: ResourceSelectionRefetchQuery) =>
        resolveResourceSelectionRefetchInterval({
          query,
          refreshHasStartedSync: resourceQuestion.refreshState.hasStartedSync,
        }),
      retry: false,
    })),
  });

  return Object.fromEntries(
    resourceQuestions.map((resourceQuestion, index) => {
      const resourceQuery = resourceQueries[index];
      const availabilityQuery = availabilityQueries[index];
      if (resourceQuery === undefined || availabilityQuery === undefined) {
        throw new Error("Expected resource query results to align with resource questions.");
      }

      const selectedValues = input.selectedValuesByAnswerKey[resourceQuestion.answerKey] ?? [];
      const availabilityItems =
        resourceQuestion.debouncedSearch.length === 0
          ? resourceQuery.data?.items
          : availabilityQuery.data?.items;
      const availabilityHandles =
        availabilityItems === undefined
          ? null
          : new Set(availabilityItems.map((item) => item.handle));
      const unavailableSelectedValues =
        availabilityHandles === null
          ? []
          : selectedValues.filter((handle) => !availabilityHandles.has(handle));
      const canSubmit =
        resourceQuery.data !== undefined &&
        availabilityHandles !== null &&
        !resourceQuery.isError &&
        !availabilityQuery.isError &&
        unavailableSelectedValues.length === 0;
      const resourceErrorMessage = !resourceQuery.isError
        ? null
        : resolveApiErrorMessage({
            error: resourceQuery.error,
            fallbackMessage: `Could not load ${resourceQuestion.question.resourceSelection.resourceLabelPlural}.`,
          });
      const refreshErrorMessage =
        resourceQuestion.refreshState.error === null ||
        resourceQuestion.refreshState.error === undefined
          ? null
          : resolveApiErrorMessage({
              error: resourceQuestion.refreshState.error,
              fallbackMessage: `Could not refresh ${resourceQuestion.question.resourceSelection.resourceLabelPlural}.`,
            });
      const listState: IntegrationResourceListViewState = resourceQuery.isPending
        ? {
            mode: "loading",
          }
        : resourceQuery.isError
          ? {
              mode: "error",
              message:
                resourceErrorMessage ??
                `Could not load ${resourceQuestion.question.resourceSelection.resourceLabelPlural}.`,
            }
          : {
              mode: "ready",
            };
      const hasPollableSyncState = shouldPollResourceSelectionQuery({
        data: resourceQuery.data,
        error: resourceQuery.error,
        refreshHasStartedSync: resourceQuestion.refreshState.hasStartedSync,
      });
      const viewState: ResourceSelectionQuestionViewState = {
        canSubmit,
        isRefreshing: resourceQuestion.refreshState.isPending || hasPollableSyncState,
        listState,
        onRefresh: () => {
          if (input.disabled) {
            return;
          }

          setRefreshStateByAnswerKey((current) => ({
            ...current,
            [resourceQuestion.answerKey]: {
              error: null,
              hasStartedSync: current[resourceQuestion.answerKey]?.hasStartedSync ?? false,
              isPending: true,
            },
          }));

          refreshIntegrationConnectionResources({
            connectionId: resourceQuestion.question.resourceSelection.connectionId,
            kind: resourceQuestion.question.resourceSelection.resourceKind,
          })
            .then(async (result) => {
              setRefreshStateByAnswerKey((current) => ({
                ...current,
                [resourceQuestion.answerKey]: {
                  error: null,
                  hasStartedSync: result.syncState === "syncing",
                  isPending: false,
                },
              }));
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: [
                    "integration-connections",
                    resourceQuestion.question.resourceSelection.connectionId,
                    "resources",
                    resourceQuestion.question.resourceSelection.resourceKind,
                  ],
                }),
                queryClient.invalidateQueries({
                  queryKey: sandboxProfileIntegrationDirectoryQueryKey(),
                }),
              ]);
            })
            .catch((error: unknown) => {
              setRefreshStateByAnswerKey((current) => ({
                ...current,
                [resourceQuestion.answerKey]: {
                  error,
                  hasStartedSync: false,
                  isPending: false,
                },
              }));
            });
        },
        refreshErrorMessage,
        search: resourceQuestion.search,
        setSearch: (search) => {
          setSearchByAnswerKey((current) => ({
            ...current,
            [resourceQuestion.answerKey]: search,
          }));
        },
        unavailableSelectedValues,
        visibleItems: resourceQuery.data?.items ?? [],
      };

      return [resourceQuestion.answerKey, viewState];
    }),
  );
}

function ToolUserInputRequestPanelContent(input: {
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: RespondToServerRequest;
  requestKey: string;
  resourceSelectionQuestionStates: Readonly<Record<string, ResourceSelectionQuestionViewState>>;
  selectedValuesByAnswerKey: Readonly<Record<string, readonly string[]>>;
  setUserInputAnswers: Dispatch<SetStateAction<Record<string, UserInputAnswerValue>>>;
  userInputAnswers: Readonly<Record<string, UserInputAnswerValue>>;
}): React.JSX.Element {
  function submitResponse(response: unknown): void {
    submitServerRequestResponse({
      onRespondToServerRequest: input.onRespondToServerRequest,
      requestId: input.entry.requestId,
      response,
    });
  }

  const submitOnOptionSelect = canSubmitUserInputOnOptionSelect(input.entry);
  const cancelAction = (
    <Button
      className={cn("text-muted-foreground", submitOnOptionSelect ? "-mt-2" : undefined)}
      disabled={input.isRespondingToServerRequest}
      onClick={() => {
        submitResponse(createUserInputCancelResponse());
      }}
      type="button"
      variant="ghost"
    >
      Cancel
    </Button>
  );
  const isSubmitDisabled =
    input.isRespondingToServerRequest ||
    input.entry.questions.some((question) => {
      const answerKey = `${input.requestKey}:${question.id}`;
      if (question.inputKind === "integrationConnectionResourceMultiSelect") {
        return input.resourceSelectionQuestionStates[answerKey]?.canSubmit !== true;
      }

      const otherOption = question.options?.find((option) => option.isOther);
      return (
        readUserInputAnswer({
          answerKey,
          otherOption,
          userInputAnswers: input.userInputAnswers,
        }).trim().length === 0
      );
    });

  return (
    <ComposerActionPanel
      actions={
        submitOnOptionSelect ? null : (
          <div className="flex w-full items-center justify-end gap-2">
            {cancelAction}
            <Button
              disabled={isSubmitDisabled}
              onClick={() => {
                submitResponse(
                  createUserInputResponse({
                    entry: input.entry,
                    requestKey: input.requestKey,
                    userInputAnswers: input.userInputAnswers,
                  }),
                );
              }}
              type="button"
            >
              Submit
            </Button>
          </div>
        )
      }
      details={
        <div className="space-y-3">
          {input.entry.questions.map((question) => {
            const answerKey = `${input.requestKey}:${question.id}`;
            const otherOption = question.options?.find((option) => option.isOther);
            const selectedAnswer = readUserInputAnswer({
              answerKey,
              otherOption,
              userInputAnswers: input.userInputAnswers,
            });
            const selectedResourceValues = input.selectedValuesByAnswerKey[answerKey] ?? [];

            return (
              <div className="space-y-2" key={question.id}>
                {input.entry.questions.length === 1 || question.header === null ? null : (
                  <p className="text-muted-foreground mx-4 text-xs font-medium">
                    {question.header}
                  </p>
                )}
                {submitOnOptionSelect ? (
                  <div className="mx-4 flex items-start justify-between gap-4">
                    <p className="text-muted-foreground ml-2 min-w-0 flex-1 text-sm leading-5">
                      {question.question}
                    </p>
                    {cancelAction}
                  </div>
                ) : (
                  <p className="text-muted-foreground ml-6 mr-4 text-sm leading-5">
                    {question.question}
                  </p>
                )}
                {question.inputKind === "integrationConnectionResourceMultiSelect" ? (
                  <IntegrationConnectionResourceMultiSelectQuestion
                    answerKey={answerKey}
                    disabled={input.isRespondingToServerRequest}
                    question={question}
                    selectedValues={selectedResourceValues}
                    state={
                      input.resourceSelectionQuestionStates[answerKey] ??
                      (() => {
                        throw new Error("Expected resource selection question state.");
                      })()
                    }
                    setUserInputAnswers={input.setUserInputAnswers}
                  />
                ) : (
                  <UserInputOptions
                    answerKey={answerKey}
                    disabled={input.isRespondingToServerRequest}
                    onSelectOption={(option) => {
                      if (!submitOnOptionSelect) {
                        return;
                      }

                      submitResponse(
                        createUserInputResponse({
                          entry: input.entry,
                          requestKey: input.requestKey,
                          selectedAnswer: {
                            questionId: question.id,
                            value: option.label,
                          },
                          userInputAnswers: input.userInputAnswers,
                        }),
                      );
                    }}
                    options={question.options ?? []}
                    selectedAnswer={selectedAnswer}
                    setUserInputAnswers={input.setUserInputAnswers}
                  />
                )}
                {otherOption === undefined ? null : otherOption.inputKind === "textarea" ? (
                  <div className="mx-4">
                    <Textarea
                      className="min-h-32"
                      disabled={input.isRespondingToServerRequest}
                      onChange={(event) => {
                        input.setUserInputAnswers((current) => ({
                          ...current,
                          [answerKey]: event.target.value,
                        }));
                      }}
                      placeholder={otherOption.label}
                      value={selectedAnswer}
                    />
                  </div>
                ) : (
                  <div className="mx-4">
                    <Input
                      disabled={input.isRespondingToServerRequest}
                      onChange={(event) => {
                        input.setUserInputAnswers((current) => ({
                          ...current,
                          [answerKey]: event.target.value,
                        }));
                      }}
                      placeholder={otherOption.label}
                      value={selectedAnswer}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {input.entry.responseErrorMessage === null ? null : (
            <p className="text-destructive text-sm">{input.entry.responseErrorMessage}</p>
          )}
        </div>
      }
      key={input.requestKey}
      padding="flush-x"
      title={null}
    />
  );
}

function createSelectedValuesByAnswerKey(input: {
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  requestKey: string;
  userInputAnswers: Readonly<Record<string, UserInputAnswerValue>>;
}): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    input.entry.questions.map((question) => {
      const answerKey = `${input.requestKey}:${question.id}`;
      return [
        answerKey,
        readResourceSelectionAnswer({
          answerKey,
          question,
          userInputAnswers: input.userInputAnswers,
        }),
      ];
    }),
  );
}

function PlainToolUserInputRequestPanel(input: {
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: RespondToServerRequest;
  requestKey: string;
  userInputAnswers: Readonly<Record<string, UserInputAnswerValue>>;
  setUserInputAnswers: Dispatch<SetStateAction<Record<string, UserInputAnswerValue>>>;
}): React.JSX.Element {
  return (
    <ToolUserInputRequestPanelContent
      entry={input.entry}
      isRespondingToServerRequest={input.isRespondingToServerRequest}
      onRespondToServerRequest={input.onRespondToServerRequest}
      requestKey={input.requestKey}
      resourceSelectionQuestionStates={{}}
      selectedValuesByAnswerKey={createSelectedValuesByAnswerKey({
        entry: input.entry,
        requestKey: input.requestKey,
        userInputAnswers: input.userInputAnswers,
      })}
      setUserInputAnswers={input.setUserInputAnswers}
      userInputAnswers={input.userInputAnswers}
    />
  );
}

function ResourceToolUserInputRequestPanel(input: {
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: RespondToServerRequest;
  requestKey: string;
  userInputAnswers: Readonly<Record<string, UserInputAnswerValue>>;
  setUserInputAnswers: Dispatch<SetStateAction<Record<string, UserInputAnswerValue>>>;
}): React.JSX.Element {
  const selectedValuesByAnswerKey = createSelectedValuesByAnswerKey({
    entry: input.entry,
    requestKey: input.requestKey,
    userInputAnswers: input.userInputAnswers,
  });
  const resourceSelectionQuestionStates = useResourceSelectionQuestionStates({
    disabled: input.isRespondingToServerRequest,
    entry: input.entry,
    requestKey: input.requestKey,
    selectedValuesByAnswerKey,
  });

  return (
    <ToolUserInputRequestPanelContent
      entry={input.entry}
      isRespondingToServerRequest={input.isRespondingToServerRequest}
      onRespondToServerRequest={input.onRespondToServerRequest}
      requestKey={input.requestKey}
      resourceSelectionQuestionStates={resourceSelectionQuestionStates}
      selectedValuesByAnswerKey={selectedValuesByAnswerKey}
      setUserInputAnswers={input.setUserInputAnswers}
      userInputAnswers={input.userInputAnswers}
    />
  );
}

function ToolUserInputRequestPanel(input: {
  entry: Extract<ServerRequestEntry, { kind: "tool-user-input" }>;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: RespondToServerRequest;
  requestKey: string;
}): React.JSX.Element {
  const [userInputAnswers, setUserInputAnswers] = useState<Record<string, UserInputAnswerValue>>(
    {},
  );
  const hasResourceSelectionQuestion = input.entry.questions.some(isResourceSelectionQuestion);

  if (!hasResourceSelectionQuestion) {
    return (
      <PlainToolUserInputRequestPanel
        entry={input.entry}
        isRespondingToServerRequest={input.isRespondingToServerRequest}
        onRespondToServerRequest={input.onRespondToServerRequest}
        requestKey={input.requestKey}
        setUserInputAnswers={setUserInputAnswers}
        userInputAnswers={userInputAnswers}
      />
    );
  }

  return (
    <ResourceToolUserInputRequestPanel
      entry={input.entry}
      isRespondingToServerRequest={input.isRespondingToServerRequest}
      onRespondToServerRequest={input.onRespondToServerRequest}
      requestKey={input.requestKey}
      setUserInputAnswers={setUserInputAnswers}
      userInputAnswers={userInputAnswers}
    />
  );
}

export function ServerRequestsPanel({
  entries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: ServerRequestsPanelProps): React.JSX.Element | null {
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
              <ToolUserInputRequestPanel
                entry={entry}
                key={requestKey}
                isRespondingToServerRequest={isRespondingToServerRequest}
                onRespondToServerRequest={onRespondToServerRequest}
                requestKey={requestKey}
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
