import type { ChatEntry } from "../chat-types.js";
import { buildChatTurnGroups } from "../chat-view-model.js";
import { ChatAssistantMessage } from "./chat-assistant-message.js";
import { ChatUserMessage } from "./chat-user-message.js";

type ChatThreadProps = {
  entries: readonly ChatEntry[];
};

function shouldRenderCommandAsCodeBlock(command: string | null): boolean {
  if (command === null) {
    return false;
  }

  return command.includes("\n") || command.length > 120;
}

export function ChatThread({ entries }: ChatThreadProps): React.JSX.Element {
  const chatTurnGroups = buildChatTurnGroups(entries);

  return (
    <div className="flex flex-col gap-10 pt-2">
      {chatTurnGroups.map((group) => (
        <div className="flex flex-col gap-4" key={group.turnId}>
          {group.userEntry === null ? null : <ChatUserMessage text={group.userEntry.text} />}
          {group.assistantBlocks.length === 0 ? null : (
            <div className="max-w-[72ch] space-y-4">
              {group.assistantBlocks.map((block) => {
                if (block.kind === "assistant-message") {
                  return (
                    <div key={block.id}>
                      <ChatAssistantMessage
                        isStreaming={block.status === "streaming"}
                        text={block.text}
                      />
                    </div>
                  );
                }

                if (block.kind === "reasoning") {
                  const normalizedSummary = block.summary.trim();
                  const isSuppressedRawReasoning =
                    block.source === "content" &&
                    (normalizedSummary.length === 0 ||
                      normalizedSummary === "[]" ||
                      normalizedSummary === "{}" ||
                      normalizedSummary === "null");
                  if (isSuppressedRawReasoning) {
                    return null;
                  }

                  return (
                    <div className="space-y-2" key={block.id}>
                      <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
                        {block.source === "summary" ? "Thinking" : "Reasoning"}
                      </p>
                      <p className="text-muted-foreground max-w-[65ch] text-sm leading-6 whitespace-pre-wrap">
                        {block.summary}
                      </p>
                    </div>
                  );
                }

                if (block.kind === "plan") {
                  return (
                    <div className="space-y-3 rounded-xl border p-3" key={block.id}>
                      <p className="font-medium text-sm">Plan</p>
                      <p className="text-sm leading-6 whitespace-pre-wrap">{block.text}</p>
                    </div>
                  );
                }

                if (block.kind === "file-change") {
                  return (
                    <div className="space-y-3 rounded-xl border p-3" key={block.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-sm">File changes</p>
                        <p className="text-muted-foreground text-xs">
                          {block.status === "streaming" ? "Updating" : "Completed"}
                        </p>
                      </div>
                      {block.changes.length === 0 ? null : (
                        <div className="space-y-2">
                          {block.changes.map((change) => (
                            <div className="rounded-md border px-3 py-2" key={change.path}>
                              <p className="font-mono text-sm break-all">{change.path}</p>
                              {change.kind === null ? null : (
                                <p className="text-muted-foreground text-xs">{change.kind}</p>
                              )}
                              {change.diff === null || change.diff.trim().length === 0 ? null : (
                                <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                                  {change.diff}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {block.output === null || block.output.trim().length === 0 ? null : (
                        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                          {block.output}
                        </pre>
                      )}
                    </div>
                  );
                }

                if (block.kind === "generic-item") {
                  return (
                    <div className="space-y-3 rounded-xl border p-3" key={block.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-sm">{block.title}</p>
                        <p className="text-muted-foreground text-xs">
                          {block.status === "streaming" ? "Running" : "Completed"}
                        </p>
                      </div>
                      {block.body === null ? null : (
                        <p className="text-sm leading-6 whitespace-pre-wrap">{block.body}</p>
                      )}
                      {block.detailsJson === null ? null : (
                        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                          {block.detailsJson}
                        </pre>
                      )}
                    </div>
                  );
                }

                const displayCommand = block.command ?? "Command unavailable";
                const renderCommandAsCodeBlock = shouldRenderCommandAsCodeBlock(displayCommand);
                return (
                  <div className="space-y-3 rounded-xl border p-3" key={block.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-sm">Command</p>
                      <p className="text-muted-foreground text-xs">
                        {block.status === "streaming" ? "Running" : "Completed"}
                      </p>
                    </div>
                    {renderCommandAsCodeBlock ? (
                      <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                        {displayCommand}
                      </pre>
                    ) : (
                      <p className="font-mono text-sm whitespace-pre-wrap break-all">
                        {displayCommand}
                      </p>
                    )}
                    {block.cwd === null ? null : (
                      <p className="text-muted-foreground text-xs">cwd: {block.cwd}</p>
                    )}
                    {block.reason === null ? null : (
                      <p className="text-muted-foreground text-xs">{block.reason}</p>
                    )}
                    {block.output === null || block.output.trim().length === 0 ? null : (
                      <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                        {block.output}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
