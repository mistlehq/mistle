package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestApplyCompiledRuntimePlanWritesRuntimeClientSetupFiles(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "client/settings.json")
	runtimePlan := decodeRuntimePlan(t, `{
		"sandboxProfileId": "sbp_runtime_apply",
		"version": 1,
		"runtimeClients": [
			{
				"clientId": "codex-cli",
				"setup": {
					"env": {},
					"files": [
						{
							"fileId": "settings",
							"path": `+quoteJSON(targetPath)+`,
							"mode": 416,
							"content": "{\"ok\":true}\n"
						}
					],
					"launchArgs": []
				},
				"processes": []
			}
		]
	}`)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, targetPath), "{\"ok\":true}\n")
	assertEqual(t, fileMode(t, targetPath), os.FileMode(0o640))
}

func TestApplyCompiledRuntimePlanReportsRuntimeFileContext(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "client/settings.txt")
	writeMode := RuntimeFileWriteModeMerge
	runtimePlan := CompiledRuntimePlan{
		RuntimeClients: []RuntimeClient{
			{
				ClientID: "codex-cli",
				Setup: RuntimeClientSetup{
					Files: []RuntimeClientSetupFile{
						{
							FileID:    "settings",
							Path:      targetPath,
							Mode:      0o640,
							Content:   "generated",
							WriteMode: &writeMode,
						},
					},
				},
			},
		},
	}
	requireNoError(t, os.MkdirAll(filepath.Dir(targetPath), 0o755))
	requireNoError(t, os.WriteFile(targetPath, []byte("existing"), 0o600))

	err := ApplyCompiledRuntimePlan(runtimePlan)

	if err == nil {
		t.Fatalf("expected runtime file error")
	}
	assertEqual(t, err.Error(), "runtime plan runtimeClients[0].setup.files[0] failed (clientId=codex-cli fileId=settings path="+targetPath+"): runtime file "+targetPath+" uses writeMode merge, but sandboxd could not infer a supported merge format")
}

func decodeRuntimePlan(t *testing.T, payload string) CompiledRuntimePlan {
	t.Helper()
	var runtimePlan CompiledRuntimePlan
	requireNoError(t, json.Unmarshal([]byte(payload), &runtimePlan))
	return runtimePlan
}

func quoteJSON(value string) string {
	payload, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(payload)
}
