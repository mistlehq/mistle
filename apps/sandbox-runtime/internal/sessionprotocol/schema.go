package sessionprotocol

import (
	"reflect"

	"github.com/invopop/jsonschema"
)

const (
	schemaRefPrefix             = "#/$defs/"
	controlMessageSchemaVersion = "https://json-schema.org/draft/2020-12/schema"
)

var controlMessageTypes = []reflect.Type{
	reflect.TypeOf(StreamOpen{}),
	reflect.TypeOf(StreamOpenOK{}),
	reflect.TypeOf(StreamOpenError{}),
	reflect.TypeOf(StreamSignal{}),
	reflect.TypeOf(StreamEvent{}),
	reflect.TypeOf(StreamClose{}),
	reflect.TypeOf(StreamReset{}),
	reflect.TypeOf(Disconnect{}),
}

// BuildControlMessageSchema builds a discriminated-union schema for sandbox
// session control messages.
func BuildControlMessageSchema() *jsonschema.Schema {
	reflector := &jsonschema.Reflector{
		Anonymous:      true,
		DoNotReference: true,
	}

	definitions := make(jsonschema.Definitions, len(controlMessageTypes))
	oneOf := make([]*jsonschema.Schema, 0, len(controlMessageTypes))

	for _, messageType := range controlMessageTypes {
		definitionName := messageType.Name()
		schema := reflector.ReflectFromType(messageType)
		schema.Version = ""
		schema.ID = ""
		schema.Definitions = nil
		definitions[definitionName] = schema
		oneOf = append(oneOf, &jsonschema.Schema{Ref: schemaRefPrefix + definitionName})
	}

	return &jsonschema.Schema{
		Version:     controlMessageSchemaVersion,
		Title:       "SandboxSessionControlMessage",
		Description: "Sandbox session websocket control messages.",
		OneOf:       oneOf,
		Definitions: definitions,
	}
}
