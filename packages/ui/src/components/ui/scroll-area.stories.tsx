import { ScrollArea } from "./scroll-area.js";

const ActivityItems = [
  "Repo synced from GitHub",
  "Secrets rotated for production",
  "Organization role updated",
  "Sandbox profile published",
  "Deployment approved by release manager",
  "Billing receipt emailed to owner",
  "Session archived after inactivity",
  "OpenAI integration reconnected",
  "New workspace invite sent",
  "Audit export generated",
  "Production rollback completed",
  "Environment variable deleted",
];

export default {
  title: "UI/Scroll Area",
  component: ScrollArea,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <ScrollArea className="h-56 w-80 rounded-md border">
        <div className="space-y-3 p-4">
          {ActivityItems.map((item) => (
            <div key={item} className="rounded-md border p-3 text-sm">
              {item}
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  },
};

export const Horizontal = {
  render: function Render() {
    return (
      <ScrollArea className="w-96 rounded-md border whitespace-nowrap">
        <div className="flex gap-3 p-4">
          {ActivityItems.slice(0, 6).map((item) => (
            <div key={item} className="w-48 shrink-0 rounded-md border p-3 text-sm">
              {item}
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  },
};
