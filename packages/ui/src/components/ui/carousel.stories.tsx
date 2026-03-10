import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card.js";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "./carousel.js";

const CarouselCards = [
  {
    title: "Release health",
    description: "CI passed on the last three production deployments.",
  },
  {
    title: "Incident queue",
    description: "No active incidents require release manager approval.",
  },
  {
    title: "Workspace growth",
    description: "Seven new members joined this month across two teams.",
  },
];

export default {
  title: "UI/Carousel",
  component: Carousel,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="mx-12 max-w-xl">
        <Carousel>
          <CarouselContent>
            {CarouselCards.map((card) => (
              <CarouselItem key={card.title}>
                <Card>
                  <CardHeader>
                    <CardTitle>{card.title}</CardTitle>
                    <CardDescription>{card.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm">
                    Storybook can inspect slide layout and control placement here.
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </div>
    );
  },
};
