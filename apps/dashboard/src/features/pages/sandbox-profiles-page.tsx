import {
  Badge,
  Button,
  CardDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";
import { useNavigate } from "react-router";

export function SandboxProfilesPage(): React.JSX.Element {
  const navigate = useNavigate();

  function navigateToCreateProfile(): void {
    void navigate("/sandbox-profiles/new");
  }

  function navigateToProfileDetail(profileId: string): void {
    void navigate(`/sandbox-profiles/${profileId}`);
  }

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-3 flex flex-row items-start justify-between">
        <div className="gap-1 flex flex-col">
          <h1 className="text-xl font-semibold">Sandbox Profiles</h1>
          <CardDescription>Manage sandbox profile configuration and lifecycle.</CardDescription>
        </div>
        <Button onClick={navigateToCreateProfile} type="button">
          Create profile
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Executables</TableHead>
            <TableHead>Triggers</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SANDBOX_PROFILE_UI_ROWS.map((profile) => (
            <TableRow key={profile.id}>
              <TableCell>
                <button
                  className="text-left font-medium underline-offset-4 hover:underline"
                  onClick={() => {
                    navigateToProfileDetail(profile.id);
                  }}
                  type="button"
                >
                  {profile.displayName}
                </button>
              </TableCell>
              <TableCell>
                <Badge
                  className={
                    profile.status === "Active"
                      ? "bg-emerald-600 text-white hover:bg-emerald-600/90"
                      : undefined
                  }
                  variant={profile.status === "Active" ? "secondary" : "outline"}
                >
                  {profile.status}
                </Badge>
              </TableCell>
              <TableCell>{profile.model}</TableCell>
              <TableCell>{profile.executables}</TableCell>
              <TableCell>{profile.triggers}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{profile.updated}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type SandboxProfileUiRow = {
  id: string;
  displayName: string;
  status: "Active" | "Draft";
  model: string;
  executables: number;
  triggers: number;
  updated: string;
};

const SANDBOX_PROFILE_UI_ROWS: SandboxProfileUiRow[] = [
  {
    id: "sandboxProfile_ui_active",
    displayName: "Customer Support Agent",
    status: "Active",
    model: "gpt-4.1",
    executables: 4,
    triggers: 2,
    updated: "2h ago",
  },
  {
    id: "sandboxProfile_ui_draft",
    displayName: "Onboarding Assistant",
    status: "Draft",
    model: "gpt-4o-mini",
    executables: 2,
    triggers: 1,
    updated: "Yesterday",
  },
];
