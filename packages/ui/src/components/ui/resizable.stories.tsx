import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable.js";

export default {
  title: "UI/Resizable",
  component: ResizablePanelGroup,
  tags: ["autodocs"],
};

export const Horizontal = {
  render: function Render() {
    return (
      <div className="h-64 rounded-lg border">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={35} minSize={20}>
            <div className="flex h-full items-center justify-center text-sm">Sessions</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={65}>
            <div className="flex h-full items-center justify-center text-sm">Transcript</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  },
};

export const Vertical = {
  render: function Render() {
    return (
      <div className="h-72 rounded-lg border">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize={50}>
            <div className="flex h-full items-center justify-center text-sm">Preview</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50}>
            <div className="flex h-full items-center justify-center text-sm">Logs</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  },
};
