import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mistle/ui";
import { useNavigate } from "react-router";

export function SessionsPage(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="gap-4 flex flex-col">
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            No active session entries are available yet. Start from sandbox profiles to launch and
            manage sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-2 flex flex-wrap">
          <Button
            onClick={() => {
              void navigate("/sandbox-profiles");
            }}
            type="button"
          >
            Open sandbox profiles
          </Button>
          <Button
            onClick={() => {
              void navigate("/sandbox-profiles/new");
            }}
            type="button"
            variant="outline"
          >
            Create profile
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
