import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mistle/ui";

type PagePlaceholderProps = {
  title: string;
  description: string;
};

export function PagePlaceholder(props: PagePlaceholderProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {props.title}
          <Badge variant="secondary">Phase 1 scaffold</Badge>
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Route is configured and ready for feature implementation.
        </p>
      </CardContent>
    </Card>
  );
}
