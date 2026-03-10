import { Slider } from "./slider.js";

export default {
  title: "UI/Slider",
  component: Slider,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="w-80">
        <Slider defaultValue={[64]} max={100} step={1} />
      </div>
    );
  },
};

export const Range = {
  render: function Render() {
    return (
      <div className="w-80">
        <Slider defaultValue={[20, 80]} max={100} min={0} step={5} />
      </div>
    );
  },
};

export const Vertical = {
  render: function Render() {
    return (
      <div className="h-48">
        <Slider defaultValue={[35]} orientation="vertical" max={100} step={1} />
      </div>
    );
  },
};
