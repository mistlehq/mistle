package runtime

import "testing"

func TestParseListenAddr(t *testing.T) {
	t.Run("normalizes port shorthand", func(t *testing.T) {
		listenAddr, err := parseListenAddr(":8090")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if listenAddr != "0.0.0.0:8090" {
			t.Fatalf("expected normalized addr 0.0.0.0:8090, got %s", listenAddr)
		}
	})

	t.Run("allows full socket addresses", func(t *testing.T) {
		listenAddr, err := parseListenAddr("127.0.0.1:8090")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if listenAddr != "127.0.0.1:8090" {
			t.Fatalf("expected listen addr 127.0.0.1:8090, got %s", listenAddr)
		}
	})

	t.Run("rejects invalid addresses", func(t *testing.T) {
		_, err := parseListenAddr("not-a-socket-address")
		if err == nil {
			t.Fatal("expected error for invalid listen address")
		}
	})
}

func TestResolveLoopbackEgressBaseURL(t *testing.T) {
	t.Run("derives the loopback egress base url from the listen port", func(t *testing.T) {
		egressBaseURL, err := resolveLoopbackEgressBaseURL(":8090")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if egressBaseURL != "http://127.0.0.1:8090/egress" {
			t.Fatalf("expected loopback egress base url http://127.0.0.1:8090/egress, got %s", egressBaseURL)
		}
	})
}
