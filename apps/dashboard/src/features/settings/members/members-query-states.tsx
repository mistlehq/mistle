import { Card, CardContent, CardHeader, CardTitle, Notice } from "@mistle/ui";

export function MembersLoadErrorState(input: { message: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Notice variant="alert">{input.message} Please try again later.</Notice>
      </CardContent>
    </Card>
  );
}
