import { Progress, ProgressLabel, ProgressValue } from "./progress.js";

export default {
  title: "UI/Progress",
  component: Progress,
  tags: ["autodocs"],
  args: {
    value: 64,
  },
};

export const Default = {
  render: function Render(args: { value: number }) {
    return (
      <div className="max-w-sm">
        <Progress {...args}>
          <ProgressLabel>Repository sync</ProgressLabel>
          <ProgressValue />
        </Progress>
      </div>
    );
  },
};

export const WithStages = {
  render: function Render() {
    return (
      <div className="max-w-sm space-y-6">
        <Progress value={20}>
          <ProgressLabel>Preparing sandbox</ProgressLabel>
          <ProgressValue />
        </Progress>
        <Progress value={72}>
          <ProgressLabel>Streaming logs</ProgressLabel>
          <ProgressValue />
        </Progress>
        <Progress value={100}>
          <ProgressLabel>Deployment complete</ProgressLabel>
          <ProgressValue />
        </Progress>
      </div>
    );
  },
};
