import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppShellAutosaveIndicator } from "./app-shell-autosave-indicator.js";

const meta = {
  title: "Dashboard/Shell/AutosaveIndicator",
  component: AppShellAutosaveIndicator,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AppShellAutosaveIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

function HeaderPreview(input: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-h-32 bg-stone-50">
      <div className="flex h-12 items-center justify-end border-b border-stone-200 bg-white px-4">
        {input.children}
      </div>
    </div>
  );
}

export const Saving: Story = {
  render: () => (
    <HeaderPreview>
      <AppShellAutosaveIndicator />
    </HeaderPreview>
  ),
};

export const NoIndicator: Story = {
  render: () => <HeaderPreview>{null}</HeaderPreview>,
};
