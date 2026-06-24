import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mistle/ui";
import type { ReactNode } from "react";

export function TriggerEditorTabs(input: {
  details: ReactNode;
  activity: ReactNode;
}): React.JSX.Element {
  return (
    <Tabs className="min-w-0 gap-4" defaultValue="details">
      <TabsList variant="line">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent className="w-full min-w-0" keepMounted value="details">
        {input.details}
      </TabsContent>
      <TabsContent className="w-full min-w-0" keepMounted value="activity">
        {input.activity}
      </TabsContent>
    </Tabs>
  );
}
