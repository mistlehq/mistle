import { Kbd, KbdGroup } from "./kbd.js";

export default {
  title: "UI/Kbd",
  component: Kbd,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return <Kbd>⌘K</Kbd>;
  },
};

export const Shortcut = {
  render: function Render() {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>Open command palette</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </div>
    );
  },
};
