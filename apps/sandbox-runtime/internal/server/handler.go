package server

import (
	"encoding/json"
	"net/http"
)

type healthResponse struct {
	Ok bool `json:"ok"`
}

func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/__healthz", healthHandler)
	return mux
}

func healthHandler(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(writer).Encode(healthResponse{Ok: true})
}
