package protocol

import "testing"

func TestParseFileSearchStreamMessages(t *testing.T) {
	query, err := ParseFileSearchStreamMessage(`{"type":"fileSearch.query","requestId":"file_search_req_123","query":"src tunnel","limit":20,"ignored":true}`)
	requireNoError(t, err)
	if query.Query == nil {
		t.Fatalf("expected fileSearch query")
	}
	assertEqual(t, query.Query.RequestID, "file_search_req_123")
	assertEqual(t, query.Query.Query, "src tunnel")
	if query.Query.Limit == nil {
		t.Fatalf("expected fileSearch query limit")
	}
	assertEqual(t, *query.Query.Limit, uint64(20))

	emptyQuery, err := ParseFileSearchStreamMessage(`{"type":"fileSearch.query","requestId":"file_search_req_123","query":""}`)
	requireNoError(t, err)
	if emptyQuery.Query == nil {
		t.Fatalf("expected empty fileSearch query")
	}
	assertEqual(t, emptyQuery.Query.Query, "")
	if emptyQuery.Query.Limit != nil {
		t.Fatalf("expected omitted fileSearch query limit")
	}

	results, err := ParseFileSearchStreamMessage(`{"type":"fileSearch.results","requestId":"file_search_req_123","query":"protocol","items":[{"path":"packages/sandboxd/tunnel","kind":"directory"},{"path":"packages/sandboxd/tunnel/protocol/control.go","kind":"file"}]}`)
	requireNoError(t, err)
	if results.Results == nil {
		t.Fatalf("expected fileSearch results")
	}
	assertEqual(t, len(results.Results.Items), 2)
	assertEqual(t, results.Results.Items[0].Kind, "directory")
	assertEqual(t, results.Results.Items[1].Kind, "file")

	searchError, err := ParseFileSearchStreamMessage(`{"type":"fileSearch.error","requestId":"file_search_req_123","code":"search_failed","message":"file search failed"}`)
	requireNoError(t, err)
	if searchError.Error == nil {
		t.Fatalf("expected fileSearch error")
	}
	assertEqual(t, searchError.Error.Code, "search_failed")

	selectMessage, err := ParseFileSearchStreamMessage(`{"type":"fileSearch.select","query":"protocol","path":"packages/sandboxd/tunnel/protocol/control.go"}`)
	requireNoError(t, err)
	if selectMessage.Select == nil {
		t.Fatalf("expected fileSearch select")
	}
	assertEqual(t, selectMessage.Select.Path, "packages/sandboxd/tunnel/protocol/control.go")
}

func TestParseFileSearchStreamMessageRejectsInvalidPayloads(t *testing.T) {
	tests := []struct {
		name     string
		payload  string
		expected string
	}{
		{
			name:     "zero query limit",
			payload:  `{"type":"fileSearch.query","requestId":"file_search_req_123","query":"protocol","limit":0}`,
			expected: "fileSearch.query limit must be a positive integer",
		},
		{
			name:     "invalid result kind",
			payload:  `{"type":"fileSearch.results","requestId":"file_search_req_123","query":"protocol","items":[{"path":"packages/sandboxd/tunnel/protocol/control.go","kind":"symlink"}]}`,
			expected: "fileSearch.results item kind is invalid",
		},
		{
			name:     "empty result path",
			payload:  `{"type":"fileSearch.results","requestId":"file_search_req_123","query":"protocol","items":[{"path":" ","kind":"file"}]}`,
			expected: "fileSearch.results items must contain only non-empty paths",
		},
		{
			name:     "empty error code",
			payload:  `{"type":"fileSearch.error","requestId":"file_search_req_123","code":"","message":"file search failed"}`,
			expected: "fileSearch.error code is required",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseFileSearchStreamMessage(test.payload)
			if err == nil {
				t.Fatalf("expected parse error")
			}
			if err.Error() != test.expected {
				t.Fatalf("expected %q, got %q", test.expected, err.Error())
			}
		})
	}
}

func TestFileSearchPayloadsMatchTunnelContract(t *testing.T) {
	results, err := FileSearchResultsPayload("file_search_req_123", "protocol", []FileSearchResultItem{
		{Path: "packages/sandboxd/tunnel/protocol/control.go", Kind: "file"},
		{Path: "packages/sandboxd/tunnel", Kind: "directory"},
	})
	requireNoError(t, err)
	assertEqual(t, results, `{"items":[{"path":"packages/sandboxd/tunnel/protocol/control.go","kind":"file"},{"path":"packages/sandboxd/tunnel","kind":"directory"}],"query":"protocol","requestId":"file_search_req_123","type":"fileSearch.results"}`)

	searchError, err := FileSearchErrorPayload("file_search_req_123", "search_failed", "file search failed")
	requireNoError(t, err)
	assertEqual(t, searchError, `{"code":"search_failed","message":"file search failed","requestId":"file_search_req_123","type":"fileSearch.error"}`)
}
