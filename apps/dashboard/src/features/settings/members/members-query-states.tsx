import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@mistle/ui";

import { StatusBox } from "../../shared/status-box.js";

export function MembersLoadingState(): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="border rounded-md p-3">
          <div className="grid grid-cols-5 gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="mt-3 grid grid-cols-5 gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function MembersLoadErrorState(input: {
  message: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <StatusBox title="Could not load members" tone="destructive">
          <p>{input.message}</p>
          <p>Please try again later.</p>
        </StatusBox>
        <div>
          <Button onClick={input.onRetry} type="button" variant="outline">
            Retry
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
