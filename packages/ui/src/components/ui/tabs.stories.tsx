import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";

export default {
  title: "UI/Tabs",
  component: Tabs,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <Tabs className="w-[28rem]" defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          Session summary, recent actions, and status metadata live here.
        </TabsContent>
        <TabsContent value="activity">
          Activity tab content is useful for validating trigger state and spacing.
        </TabsContent>
        <TabsContent value="settings">
          Settings tab content shows how the component handles longer labels and text.
        </TabsContent>
      </Tabs>
    );
  },
};

export const LineVariant = {
  render: function Render() {
    return (
      <Tabs className="w-[28rem]" defaultValue="general">
        <TabsList variant="line">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        <TabsContent value="general">General account preferences.</TabsContent>
        <TabsContent value="security">Security and access controls.</TabsContent>
        <TabsContent value="notifications">Notification delivery settings.</TabsContent>
      </Tabs>
    );
  },
};

export const Vertical = {
  render: function Render() {
    return (
      <Tabs className="w-[32rem]" defaultValue="pending" orientation="vertical">
        <TabsList className="w-44" variant="line">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent className="rounded-md border p-4" value="pending">
          Requests awaiting a decision are listed here.
        </TabsContent>
        <TabsContent className="rounded-md border p-4" value="approved">
          Approved requests and execution history are listed here.
        </TabsContent>
        <TabsContent className="rounded-md border p-4" value="rejected">
          Rejected requests and reviewer notes are listed here.
        </TabsContent>
      </Tabs>
    );
  },
};
