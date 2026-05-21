import type { ReactNode } from "react";

export type TriggerEditorFrameState = "editor" | "unavailable";

export type TriggerEditorFrameRenderer = (input: {
  children: ReactNode;
  state: TriggerEditorFrameState;
}) => React.JSX.Element;

export function renderTriggerEditorFrameContent(input: {
  content: ReactNode;
  renderFrame: TriggerEditorFrameRenderer | undefined;
  state: TriggerEditorFrameState;
}): React.JSX.Element | null {
  if (input.renderFrame === undefined) {
    return input.content === null || input.content === undefined ? null : <>{input.content}</>;
  }

  return input.renderFrame({
    children: input.content,
    state: input.state,
  });
}
