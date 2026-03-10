package sessionprotocol

import (
	"testing"
)

func TestBuildControlMessageSchema(t *testing.T) {
	schema := BuildControlMessageSchema()

	if schema == nil {
		t.Fatal("expected schema to be non-nil")
	}
	if schema.Title != "SandboxSessionControlMessage" {
		t.Fatalf("expected schema title to be SandboxSessionControlMessage, got %q", schema.Title)
	}
	if len(schema.OneOf) != 10 {
		t.Fatalf("expected oneOf to include 10 message definitions, got %d", len(schema.OneOf))
	}
	if len(schema.Definitions) != 10 {
		t.Fatalf("expected 10 schema definitions, got %d", len(schema.Definitions))
	}

	expectedDefinitionNames := []string{
		"AgentConnectRequest",
		"PTYConnectRequest",
		"ConnectOK",
		"ConnectError",
		"Disconnect",
		"PTYResize",
		"PTYClose",
		"PTYCloseOK",
		"PTYCloseError",
		"PTYExit",
	}

	for _, definitionName := range expectedDefinitionNames {
		if _, found := schema.Definitions[definitionName]; !found {
			t.Fatalf("expected schema definition %q", definitionName)
		}
	}
}
