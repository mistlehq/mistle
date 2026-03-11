package runtime

import "testing"

func TestMergedProcessEnvironment(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:8090")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:8090")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("GH_TOKEN", "dummy-token")

	merged := mergedProcessEnvironment(map[string]string{
		"PROCESS_ONLY": "enabled",
	})
	mergedMap := make(map[string]string, len(merged))
	for _, entry := range merged {
		key, value, found := splitEnvironmentEntry(entry)
		if !found {
			t.Fatalf("expected merged environment entry to contain '=', got %s", entry)
		}
		mergedMap[key] = value
	}

	if mergedMap["HTTP_PROXY"] != "http://127.0.0.1:8090" {
		t.Fatalf("expected HTTP_PROXY to be inherited, got %s", mergedMap["HTTP_PROXY"])
	}
	if mergedMap["HTTPS_PROXY"] != "http://127.0.0.1:8090" {
		t.Fatalf("expected HTTPS_PROXY to be inherited, got %s", mergedMap["HTTPS_PROXY"])
	}
	if mergedMap["NO_PROXY"] != "127.0.0.1,localhost" {
		t.Fatalf("expected NO_PROXY to be inherited, got %s", mergedMap["NO_PROXY"])
	}
	if mergedMap["GH_TOKEN"] != "dummy-token" {
		t.Fatalf("expected GH_TOKEN to be inherited, got %s", mergedMap["GH_TOKEN"])
	}
	if mergedMap["PROCESS_ONLY"] != "enabled" {
		t.Fatalf("expected PROCESS_ONLY to be set, got %s", mergedMap["PROCESS_ONLY"])
	}
}

func splitEnvironmentEntry(entry string) (key string, value string, found bool) {
	for index := 0; index < len(entry); index += 1 {
		if entry[index] != '=' {
			continue
		}
		return entry[:index], entry[index+1:], true
	}

	return "", "", false
}
