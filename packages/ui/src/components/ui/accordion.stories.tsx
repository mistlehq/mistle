import type { Meta, StoryObj } from "@storybook/react-vite";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion.js";

const meta = {
  title: "UI/Accordion",
  component: Accordion,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <Accordion className="w-[560px]" defaultValue={["runtime"]} multiple>
        <AccordionItem value="runtime">
          <AccordionTrigger>Runtime details</AccordionTrigger>
          <AccordionContent>
            The session is pinned to the `ubuntu-22.04` image with persistent workspace mounting
            enabled for iterative review work.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="bindings">
          <AccordionTrigger>Bindings and integrations</AccordionTrigger>
          <AccordionContent>
            GitHub and OpenAI bindings are configured, and outbound network access is limited to the
            approved egress allowlist.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="audit">
          <AccordionTrigger>Audit notes</AccordionTrigger>
          <AccordionContent>
            The last profile update passed validation and no unresolved policy warnings remain.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  },
};
