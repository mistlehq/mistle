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
	if len(schema.OneOf) != 9 {
		t.Fatalf("expected oneOf to include 9 message definitions, got %d", len(schema.OneOf))
	}
	if len(schema.Definitions) != 9 {
		t.Fatalf("expected 9 schema definitions, got %d", len(schema.Definitions))
	}

	expectedDefinitionNames := []string{
		"AgentConnectRequest",
		"PTYConnectRequest",
		"ConnectOK",
		"ConnectError",
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
