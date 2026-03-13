package tunnel

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	tunnelTokenExchangeRouteSuffix   = "/token-exchange"
	tunnelTokenExchangeRetryDelayMin = time.Second
	tunnelTokenExchangeRetryDelayMax = 30 * time.Second
)

type tunnelTokens struct {
	mutex               sync.RWMutex
	bootstrapToken      string
	tunnelExchangeToken string
}

type tunnelTokenExchangeLoopInput struct {
	Context      context.Context
	GatewayWSURL string
	HTTPClient   *http.Client
	Tokens       *tunnelTokens
}

type tunnelTokenExchangeResponse struct {
	BootstrapToken      string `json:"bootstrapToken"`
	TunnelExchangeToken string `json:"tunnelExchangeToken"`
}

type tunnelTokenExchangeError struct {
	err       error
	retryable bool
}

func (err tunnelTokenExchangeError) Error() string {
	return err.err.Error()
}

func (err tunnelTokenExchangeError) Unwrap() error {
	return err.err
}

func newTunnelTokens(bootstrapToken string, tunnelExchangeToken string) (*tunnelTokens, error) {
	normalizedBootstrapToken, err := normalizeTunnelTokenValue("bootstrap", bootstrapToken)
	if err != nil {
		return nil, err
	}
	normalizedTunnelExchangeToken, err := normalizeTunnelTokenValue("exchange", tunnelExchangeToken)
	if err != nil {
		return nil, err
	}

	return &tunnelTokens{
		bootstrapToken:      normalizedBootstrapToken,
		tunnelExchangeToken: normalizedTunnelExchangeToken,
	}, nil
}

func normalizeTunnelTokenValue(tokenKind string, token string) (string, error) {
	normalizedToken := strings.TrimSpace(token)
	if normalizedToken == "" {
		return "", fmt.Errorf("sandbox tunnel %s token is required", tokenKind)
	}

	return normalizedToken, nil
}

func (tokens *tunnelTokens) CurrentBootstrapToken() string {
	tokens.mutex.RLock()
	defer tokens.mutex.RUnlock()

	return tokens.bootstrapToken
}

func (tokens *tunnelTokens) CurrentTunnelExchangeToken() string {
	tokens.mutex.RLock()
	defer tokens.mutex.RUnlock()

	return tokens.tunnelExchangeToken
}

func (tokens *tunnelTokens) Replace(bootstrapToken string, tunnelExchangeToken string) error {
	normalizedBootstrapToken, err := normalizeTunnelTokenValue("bootstrap", bootstrapToken)
	if err != nil {
		return err
	}
	normalizedTunnelExchangeToken, err := normalizeTunnelTokenValue("exchange", tunnelExchangeToken)
	if err != nil {
		return err
	}

	tokens.mutex.Lock()
	defer tokens.mutex.Unlock()

	tokens.bootstrapToken = normalizedBootstrapToken
	tokens.tunnelExchangeToken = normalizedTunnelExchangeToken
	return nil
}

func buildTunnelTokenExchangeURL(gatewayWSURL string) (string, error) {
	parsedGatewayURL, err := parseGatewayURL(gatewayWSURL)
	if err != nil {
		return "", err
	}

	switch parsedGatewayURL.Scheme {
	case "ws":
		parsedGatewayURL.Scheme = "http"
	case "wss":
		parsedGatewayURL.Scheme = "https"
	default:
		return "", fmt.Errorf("sandbox tunnel gateway ws url must use ws or wss scheme")
	}

	parsedGatewayURL.Path = strings.TrimRight(parsedGatewayURL.Path, "/") + tunnelTokenExchangeRouteSuffix
	parsedGatewayURL.RawQuery = ""
	parsedGatewayURL.Fragment = ""

	return parsedGatewayURL.String(), nil
}

func parseTunnelTokenJWTWindow(token string) (time.Time, time.Time, error) {
	normalizedToken, err := normalizeTunnelTokenValue("exchange", token)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}

	tokenSegments := strings.Split(normalizedToken, ".")
	if len(tokenSegments) != 3 {
		return time.Time{}, time.Time{}, fmt.Errorf("sandbox tunnel exchange token must be a JWT")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(tokenSegments[1])
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("failed to decode sandbox tunnel exchange token payload: %w", err)
	}

	var payload struct {
		Exp *int64 `json:"exp"`
		Iat *int64 `json:"iat"`
	}
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("failed to parse sandbox tunnel exchange token payload: %w", err)
	}
	if payload.Iat == nil {
		return time.Time{}, time.Time{}, fmt.Errorf("sandbox tunnel exchange token iat claim is required")
	}
	if payload.Exp == nil {
		return time.Time{}, time.Time{}, fmt.Errorf("sandbox tunnel exchange token exp claim is required")
	}

	issuedAt := time.Unix(*payload.Iat, 0).UTC()
	expiresAt := time.Unix(*payload.Exp, 0).UTC()
	if !expiresAt.After(issuedAt) {
		return time.Time{}, time.Time{}, fmt.Errorf("sandbox tunnel exchange token exp claim must be after iat")
	}

	return issuedAt, expiresAt, nil
}

func nextTunnelTokenExchangeDelay(now time.Time, issuedAt time.Time, expiresAt time.Time) (time.Duration, error) {
	if !expiresAt.After(issuedAt) {
		return 0, fmt.Errorf("sandbox tunnel exchange token exp claim must be after iat")
	}

	renewAt := issuedAt.Add(expiresAt.Sub(issuedAt) * 4 / 5)
	if !renewAt.After(now) {
		return 0, nil
	}

	return renewAt.Sub(now), nil
}

func nextTunnelTokenExchangeRetryDelay(attempt int) time.Duration {
	delay := tunnelTokenExchangeRetryDelayMin
	for retryIndex := 1; retryIndex < attempt; retryIndex++ {
		if delay >= tunnelTokenExchangeRetryDelayMax/2 {
			return tunnelTokenExchangeRetryDelayMax
		}
		delay *= 2
	}

	return delay
}

func isRetryableTunnelTokenExchangeStatus(statusCode int) bool {
	return statusCode == http.StatusRequestTimeout ||
		statusCode == http.StatusTooManyRequests ||
		statusCode >= http.StatusInternalServerError
}

func shouldRetryTunnelTokenExchange(err error) bool {
	var exchangeErr tunnelTokenExchangeError
	return errors.As(err, &exchangeErr) && exchangeErr.retryable
}

func exchangeTunnelTokens(ctx context.Context, httpClient *http.Client, exchangeURL string, tunnelExchangeToken string) (tunnelTokenExchangeResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, exchangeURL, bytes.NewReader(nil))
	if err != nil {
		return tunnelTokenExchangeResponse{}, fmt.Errorf("failed to create sandbox tunnel token exchange request: %w", err)
	}
	request.Header.Set("authorization", "Bearer "+tunnelExchangeToken)

	response, err := httpClient.Do(request)
	if err != nil {
		return tunnelTokenExchangeResponse{}, tunnelTokenExchangeError{
			err:       fmt.Errorf("sandbox tunnel token exchange request failed: %w", err),
			retryable: true,
		}
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return tunnelTokenExchangeResponse{}, tunnelTokenExchangeError{
			err:       fmt.Errorf("sandbox tunnel token exchange request failed with status %d", response.StatusCode),
			retryable: isRetryableTunnelTokenExchangeStatus(response.StatusCode),
		}
	}

	var payload tunnelTokenExchangeResponse
	decoder := json.NewDecoder(response.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return tunnelTokenExchangeResponse{}, fmt.Errorf("failed to decode sandbox tunnel token exchange response: %w", err)
	}

	if err := payload.validate(); err != nil {
		return tunnelTokenExchangeResponse{}, err
	}

	return payload, nil
}

func (response tunnelTokenExchangeResponse) validate() error {
	if _, err := normalizeTunnelTokenValue("bootstrap", response.BootstrapToken); err != nil {
		return fmt.Errorf("sandbox tunnel token exchange response bootstrap token is invalid: %w", err)
	}
	if _, err := normalizeTunnelTokenValue("exchange", response.TunnelExchangeToken); err != nil {
		return fmt.Errorf("sandbox tunnel token exchange response exchange token is invalid: %w", err)
	}

	return nil
}

func runTunnelTokenExchangeLoop(input tunnelTokenExchangeLoopInput) error {
	if input.Context == nil {
		return fmt.Errorf("sandbox tunnel token exchange context is required")
	}
	if input.HTTPClient == nil {
		return fmt.Errorf("sandbox tunnel token exchange http client is required")
	}
	if input.Tokens == nil {
		return fmt.Errorf("sandbox tunnel token exchange tokens are required")
	}

	exchangeURL, err := buildTunnelTokenExchangeURL(input.GatewayWSURL)
	if err != nil {
		return err
	}

	for {
		currentExchangeToken := input.Tokens.CurrentTunnelExchangeToken()
		issuedAt, expiresAt, err := parseTunnelTokenJWTWindow(currentExchangeToken)
		if err != nil {
			return err
		}

		delay, err := nextTunnelTokenExchangeDelay(time.Now().UTC(), issuedAt, expiresAt)
		if err != nil {
			return err
		}

		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-input.Context.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return nil
			case <-timer.C:
			}
		} else {
			select {
			case <-input.Context.Done():
				return nil
			default:
			}
		}

		for retryAttempt := 1; ; retryAttempt++ {
			if input.Context.Err() != nil {
				return nil
			}
			if !time.Now().UTC().Before(expiresAt) {
				return fmt.Errorf("sandbox tunnel exchange token expired before renewal succeeded")
			}

			exchangeResponse, err := exchangeTunnelTokens(
				input.Context,
				input.HTTPClient,
				exchangeURL,
				currentExchangeToken,
			)
			if err == nil {
				if _, _, parseErr := parseTunnelTokenJWTWindow(exchangeResponse.TunnelExchangeToken); parseErr != nil {
					return parseErr
				}
				if replaceErr := input.Tokens.Replace(
					exchangeResponse.BootstrapToken,
					exchangeResponse.TunnelExchangeToken,
				); replaceErr != nil {
					return replaceErr
				}
				break
			}

			if input.Context.Err() != nil {
				return nil
			}
			if !shouldRetryTunnelTokenExchange(err) {
				return err
			}

			retryDelay := nextTunnelTokenExchangeRetryDelay(retryAttempt)
			remainingUntilExpiry := time.Until(expiresAt)
			if remainingUntilExpiry <= 0 {
				return fmt.Errorf("sandbox tunnel exchange token expired after retryable exchange failures: %w", err)
			}
			if retryDelay > remainingUntilExpiry {
				retryDelay = remainingUntilExpiry
			}

			timer := time.NewTimer(retryDelay)
			select {
			case <-input.Context.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return nil
			case <-timer.C:
			}
		}
	}
}
