import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "./native-select.js";

export default {
  title: "UI/Native Select",
  component: NativeSelect,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <NativeSelect defaultValue="30">
        <NativeSelectOption value="7">7 days</NativeSelectOption>
        <NativeSelectOption value="30">30 days</NativeSelectOption>
        <NativeSelectOption value="90">90 days</NativeSelectOption>
      </NativeSelect>
    );
  },
};

export const Grouped = {
  render: function Render() {
    return (
      <NativeSelect defaultValue="owner">
        <NativeSelectOptGroup label="Workspace roles">
          <NativeSelectOption value="owner">Owner</NativeSelectOption>
          <NativeSelectOption value="admin">Admin</NativeSelectOption>
          <NativeSelectOption value="member">Member</NativeSelectOption>
        </NativeSelectOptGroup>
        <NativeSelectOptGroup label="Read-only">
          <NativeSelectOption value="observer">Observer</NativeSelectOption>
        </NativeSelectOptGroup>
      </NativeSelect>
    );
  },
};

export const Small = {
  render: function Render() {
    return (
      <NativeSelect defaultValue="weekly" size="sm">
        <NativeSelectOption value="daily">Daily digest</NativeSelectOption>
        <NativeSelectOption value="weekly">Weekly digest</NativeSelectOption>
        <NativeSelectOption value="never">Never</NativeSelectOption>
      </NativeSelect>
    );
  },
};
