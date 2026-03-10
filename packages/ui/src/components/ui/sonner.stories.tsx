import { ThemeProvider } from "next-themes";
import { toast } from "sonner";

import { Button } from "./button.js";
import { Toaster } from "./sonner.js";

export default {
  title: "UI/Sonner",
  component: Toaster,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  render: function Render() {
    return (
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <div className="flex min-h-screen items-center justify-center">
          <Button
            type="button"
            onClick={() => {
              toast.success("Workspace saved", {
                description: "Notification settings were updated successfully.",
              });
            }}
          >
            Show toast
          </Button>
          <Toaster />
        </div>
      </ThemeProvider>
    );
  },
};
