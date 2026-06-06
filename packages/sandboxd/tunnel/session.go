package tunnel

import (
	"fmt"
	"net/url"
)

func DeriveSandboxInstanceID(gatewayWSURL string) (string, error) {
	parsedURL, err := url.Parse(gatewayWSURL)
	if err != nil {
		return "", fmt.Errorf("tunnel gateway url is invalid: %w", err)
	}
	if parsedURL.Scheme == "" || parsedURL.Host == "" {
		return "", fmt.Errorf("tunnel gateway url is invalid: absolute ws url is required")
	}
	for index := len(parsedURL.Path) - 1; index >= 0; index-- {
		if parsedURL.Path[index] != '/' {
			end := index + 1
			for index >= 0 && parsedURL.Path[index] != '/' {
				index--
			}
			return parsedURL.Path[index+1 : end], nil
		}
	}
	return "", fmt.Errorf("tunnel gateway url must end with the sandbox instance id path segment")
}
