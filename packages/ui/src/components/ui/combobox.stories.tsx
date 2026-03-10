import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
} from "./combobox.js";

export default {
  title: "UI/Combobox",
  component: Combobox,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="w-72">
        <Combobox defaultOpen defaultValue="GitHub">
          <ComboboxInput placeholder="Select integration" />
          <ComboboxContent>
            <ComboboxList>
              <ComboboxGroup>
                <ComboboxLabel>Available</ComboboxLabel>
                <ComboboxItem value="GitHub">GitHub</ComboboxItem>
                <ComboboxItem value="Linear">Linear</ComboboxItem>
                <ComboboxItem value="OpenAI">OpenAI</ComboboxItem>
              </ComboboxGroup>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    );
  },
};

export const Grouped = {
  render: function Render() {
    return (
      <div className="w-80">
        <Combobox defaultOpen>
          <ComboboxInput placeholder="Search projects" showClear />
          <ComboboxContent>
            <ComboboxList>
              <ComboboxGroup>
                <ComboboxLabel>Owned by platform</ComboboxLabel>
                <ComboboxItem value="control-plane-api">control-plane-api</ComboboxItem>
                <ComboboxItem value="dashboard">dashboard</ComboboxItem>
              </ComboboxGroup>
              <ComboboxSeparator />
              <ComboboxGroup>
                <ComboboxLabel>Archived</ComboboxLabel>
                <ComboboxItem value="prototype-ui">prototype-ui</ComboboxItem>
              </ComboboxGroup>
              <ComboboxEmpty>No matching repositories.</ComboboxEmpty>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    );
  },
};
