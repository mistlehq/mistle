package egress

import (
	"go.opentelemetry.io/otel/attribute"
)

func buildProxyMediationBaseAttributes(classificationHost string, classificationMethod string, classificationPath string) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.String("server.address", classificationHost),
		attribute.String("http.request.method", classificationMethod),
		attribute.String("url.path", classificationPath),
	}
}
