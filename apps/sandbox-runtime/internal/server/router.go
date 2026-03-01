package server

import (
	"io"
	"net/http"
)

type RouterInput struct {
	BootstrapTokenLoaded bool
	EgressHandler        http.Handler
}

func NewRouter(input RouterInput) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/__healthz", healthHandler(input))
	if input.EgressHandler != nil {
		mux.Handle("/egress/routes/", input.EgressHandler)
	}
	return mux
}

func healthHandler(input RouterInput) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		writer.Header().Set("Content-Type", "application/json")
		if !input.BootstrapTokenLoaded {
			writer.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(writer, `{"ok":false}`)
			return
		}

		writer.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(writer, `{"ok":true}`)
	}
}
