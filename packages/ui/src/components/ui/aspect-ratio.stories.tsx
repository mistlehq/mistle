import { AspectRatio } from "./aspect-ratio.js";

export default {
  title: "UI/Aspect Ratio",
  component: AspectRatio,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="w-80">
        <AspectRatio ratio={16 / 9} className="overflow-hidden rounded-lg border">
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-orange-100 to-amber-200 text-sm font-medium">
            16:9 preview
          </div>
        </AspectRatio>
      </div>
    );
  },
};

export const Square = {
  render: function Render() {
    return (
      <div className="w-56">
        <AspectRatio ratio={1} className="overflow-hidden rounded-lg border">
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-sm font-medium">
            1:1 asset
          </div>
        </AspectRatio>
      </div>
    );
  },
};
