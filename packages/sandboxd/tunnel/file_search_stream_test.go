package tunnel

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

func TestSearchFilesReturnsMatchingFilesAndDirectoriesFromCWDLikeRust(t *testing.T) {
	root := t.TempDir()
	requireNoError(t, os.Mkdir(filepath.Join(root, "src"), 0o755))
	requireNoError(t, os.WriteFile(filepath.Join(root, "src", "protocol.go"), []byte("package src\n"), 0o644))
	requireNoError(t, os.WriteFile(filepath.Join(root, "README.md"), []byte("docs\n"), 0o644))

	fileItems, err := SearchFiles(fileSearchTestChannel(root), fileSearchTestQuery("request_1", "protocol", 10))
	requireNoError(t, err)
	directoryItems, err := SearchFiles(fileSearchTestChannel(root), fileSearchTestQuery("request_2", "src/", 10))
	requireNoError(t, err)

	assertFileSearchContains(t, fileItems, tunnelprotocol.FileSearchResultItem{Path: "src/protocol.go", Kind: "file"})
	assertFileSearchContains(t, directoryItems, tunnelprotocol.FileSearchResultItem{Path: "src", Kind: "directory"})
}

func TestSearchFilesCapsRequestedLimitLikeRust(t *testing.T) {
	root := t.TempDir()
	for index := range maxFileSearchLimit + 5 {
		requireNoError(t, os.WriteFile(filepath.Join(root, "match-"+strconv.Itoa(index)+".txt"), []byte("match\n"), 0o644))
	}

	items, err := SearchFiles(fileSearchTestChannel(root), fileSearchTestQuery("request_1", "match", maxFileSearchLimit+1))
	requireNoError(t, err)

	assertEqual(t, len(items), maxFileSearchLimit)
}

func fileSearchTestChannel(root string) tunnelprotocol.StreamChannel {
	return tunnelprotocol.StreamChannel{
		Kind: "fileSearch",
		CWD:  &root,
	}
}

func fileSearchTestQuery(requestID string, query string, limit uint64) tunnelprotocol.FileSearchQuery {
	return tunnelprotocol.FileSearchQuery{
		MessageType: "fileSearch.query",
		RequestID:   requestID,
		Query:       query,
		Limit:       &limit,
	}
}

func assertFileSearchContains(t *testing.T, items []tunnelprotocol.FileSearchResultItem, expected tunnelprotocol.FileSearchResultItem) {
	t.Helper()
	for _, item := range items {
		if item == expected {
			return
		}
	}
	t.Fatalf("expected file search results to contain %#v, got %#v", expected, items)
}
