import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
} from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "./form-page.js";
import { FormPageFrame } from "./page-frame.js";

function FormPageStoryPreview(): React.JSX.Element {
  return (
    <FormPageFrame
      description="Shared form-page surface for dashboard editors."
      title="Editor Shell"
    >
      <FormPageStack>
        <FormPageSection header={<h2 className="text-base font-semibold">General Settings</h2>}>
          <div className="p-4">
            <Field>
              <FieldHeader>
                <FieldLabel htmlFor="storybook-form-page-name">Display name</FieldLabel>
                <FieldDescription>Choose the name shown across the dashboard.</FieldDescription>
              </FieldHeader>
              <FieldContent>
                <Input defaultValue="Mistle Developer" id="storybook-form-page-name" />
              </FieldContent>
            </Field>
          </div>
        </FormPageSection>

        <FormPageActionBar>
          <Button type="button">Save changes</Button>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </FormPageActionBar>
      </FormPageStack>
    </FormPageFrame>
  );
}

const meta = {
  title: "Dashboard/Shared/FormPage",
  component: FormPageStoryPreview,
  decorators: [withDashboardCenteredSurface],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof FormPageStoryPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
