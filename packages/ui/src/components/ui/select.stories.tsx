import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js";

export default {
  title: "UI/Select",
  component: Select,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="w-64">
        <Select defaultValue="owner">
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Organization roles</SelectLabel>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    );
  },
};

export const Grouped = {
  render: function Render() {
    return (
      <div className="w-72">
        <Select defaultValue="github">
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an integration" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Available</SelectLabel>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="linear">Linear</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Preview</SelectLabel>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem disabled value="slack">
                Slack
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    );
  },
};

export const Small = {
  render: function Render() {
    return (
      <div className="w-52">
        <Select defaultValue="30">
          <SelectTrigger className="w-full" size="sm">
            <SelectValue placeholder="Retention" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  },
};
