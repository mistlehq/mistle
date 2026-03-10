import { CaretDownIcon } from "@phosphor-icons/react";

import { Button } from "./button.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.js";

export default {
  title: "UI/Collapsible",
  component: Collapsible,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="w-96 rounded-lg border p-3">
        <Collapsible defaultOpen>
          <CollapsibleTrigger
            render={<Button type="button" variant="ghost" className="w-full justify-between" />}
          >
            Deployment notes
            <CaretDownIcon />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 text-sm">
            Production deploy completed successfully. Background jobs drained in 42 seconds and no
            rollback actions were triggered.
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  },
};
