package cli

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	streamID                  = uint32(1)
	dataFrameKind             = byte(0x01)
	payloadKindWebSocketText  = byte(0x02)
	payloadKindWebSocketBytes = byte(0x03)
	agentStreamWindowBytes    = 16 * 1024 * 1024
	streamOpenTimeout         = 30 * time.Second

	codexMistleModelProviderID     = "mistle-remote"
	codexMistleModelProviderConfig = `model_providers.mistle-remote={ name = "Mistle Remote", base_url = "http://127.0.0.1:1/v1", wire_api = "responses", requires_openai_auth = false, supports_websockets = true }`
)

type codexRunConfig struct {
	TunnelURL string
	CodexArgs []string
}

type streamDataFrame struct {
	StreamID    uint32
	PayloadKind byte
	Payload     []byte
}

type streamControlMessage struct {
	Type     string `json:"type"`
	StreamID uint32 `json:"streamId"`
	Code     string `json:"code,omitempty"`
	Message  string `json:"message,omitempty"`
	Bytes    int    `json:"bytes,omitempty"`
}

func runCodex(command Command) error {
	if err := validateCodexArgs(command.CodexArgs); err != nil {
		return fmt.Errorf("failed to validate codex arguments: %w", err)
	}
	client, err := mistleClient()
	if err != nil {
		return err
	}
	connectionToken, err := client.CreateSandboxInstanceConnectionToken(command.SandboxID)
	if err != nil {
		return fmt.Errorf("failed to create sandbox connection token: %w", err)
	}
	return runCodexProxy(codexRunConfig{
		TunnelURL: connectionToken.URL,
		CodexArgs: command.CodexArgs,
	})
}

func runCodexProxy(config codexRunConfig) error {
	if err := validateCodexArgs(config.CodexArgs); err != nil {
		return err
	}
	ctx := context.Background()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("failed to bind local proxy: %w", err)
	}
	defer listener.Close()

	remoteURL := "ws://" + listener.Addr().String()
	commandArgs, err := codexCommandArgs(remoteURL, config.CodexArgs)
	if err != nil {
		return err
	}
	codexHome, err := createCodexHome()
	if err != nil {
		return err
	}
	defer os.RemoveAll(codexHome)

	server := &http.Server{}
	codexConnChannel := make(chan websocketAcceptResult, 1)
	server.Handler = http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		conn, acceptErr := websocket.Accept(response, request, nil)
		codexConnChannel <- websocketAcceptResult{Conn: conn, Err: acceptErr}
	})
	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			codexConnChannel <- websocketAcceptResult{Err: err}
		}
	}()
	defer server.Close()

	fmt.Fprintf(os.Stderr, "mistle: starting local Codex proxy on %s\n", remoteURL)
	child := exec.Command("codex", commandArgs...)
	child.Env = append(os.Environ(), "CODEX_HOME="+codexHome)
	child.Stdin = os.Stdin
	child.Stdout = os.Stdout
	child.Stderr = os.Stderr
	if err := child.Start(); err != nil {
		return fmt.Errorf("failed to spawn codex: %w", err)
	}
	waitChannel := make(chan error, 1)
	go func() {
		waitChannel <- child.Wait()
	}()

	codexConn, err := waitForCodexConnection(codexConnChannel, waitChannel)
	if err != nil {
		return err
	}
	defer codexConn.Close(websocket.StatusNormalClosure, "")

	fmt.Fprintln(os.Stderr, "mistle: connecting to Mistle sandbox tunnel")
	tunnelConn, _, err := websocket.Dial(ctx, config.TunnelURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect Mistle tunnel websocket: %w", err)
	}
	defer tunnelConn.Close(websocket.StatusNormalClosure, "")

	if err := openAgentStream(ctx, tunnelConn); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "mistle: connected Codex to sandbox agent stream")

	bridgeErr := bridgeCodexToTunnel(ctx, codexConn, tunnelConn)
	waitErr := <-waitChannel
	if bridgeErr != nil {
		return bridgeErr
	}
	if waitErr != nil {
		return fmt.Errorf("codex exited unsuccessfully: %w", waitErr)
	}
	return nil
}

type websocketAcceptResult struct {
	Conn *websocket.Conn
	Err  error
}

func waitForCodexConnection(codexConnChannel <-chan websocketAcceptResult, waitChannel <-chan error) (*websocket.Conn, error) {
	select {
	case result := <-codexConnChannel:
		if result.Err != nil {
			return nil, fmt.Errorf("failed to accept codex websocket connection: %w", result.Err)
		}
		return result.Conn, nil
	case err := <-waitChannel:
		if err != nil {
			return nil, fmt.Errorf("codex exited before connecting to the local proxy: %w", err)
		}
		return nil, errors.New("codex exited before connecting to the local proxy")
	}
}

func openAgentStream(ctx context.Context, tunnelConn *websocket.Conn) error {
	openMessage := streamControlMessage{
		Type:     "stream.open",
		StreamID: streamID,
	}
	payload, err := json.Marshal(struct {
		Type     string         `json:"type"`
		StreamID uint32         `json:"streamId"`
		Channel  map[string]any `json:"channel"`
	}{
		Type:     openMessage.Type,
		StreamID: openMessage.StreamID,
		Channel:  map[string]any{"kind": "agent"},
	})
	if err != nil {
		return fmt.Errorf("failed to encode Mistle tunnel control message: %w", err)
	}
	if err := tunnelConn.Write(ctx, websocket.MessageText, payload); err != nil {
		return fmt.Errorf("failed to write Mistle tunnel: %w", err)
	}

	openCtx, cancel := context.WithTimeout(ctx, streamOpenTimeout)
	defer cancel()
	for {
		messageType, payload, err := tunnelConn.Read(openCtx)
		if err != nil {
			if errors.Is(openCtx.Err(), context.DeadlineExceeded) {
				return errors.New("timed out waiting for sandbox agent stream to open")
			}
			return fmt.Errorf("failed to read Mistle tunnel: %w", err)
		}
		if messageType != websocket.MessageText {
			continue
		}
		var control streamControlMessage
		if err := json.Unmarshal(payload, &control); err != nil {
			return fmt.Errorf("failed to decode Mistle tunnel control message: %w", err)
		}
		if control.StreamID != streamID {
			continue
		}
		switch control.Type {
		case "stream.open.ok":
			return nil
		case "stream.open.error":
			return fmt.Errorf("sandbox agent stream rejected (%s): %s", control.Code, control.Message)
		}
	}
}

func bridgeCodexToTunnel(ctx context.Context, codexConn *websocket.Conn, tunnelConn *websocket.Conn) error {
	bridgeCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	errChannel := make(chan error, 2)
	sendWindow := &sendWindowState{bytes: agentStreamWindowBytes}
	go func() {
		errChannel <- relayCodexToTunnel(bridgeCtx, codexConn, tunnelConn, sendWindow)
	}()
	go func() {
		errChannel <- relayTunnelToCodex(bridgeCtx, codexConn, tunnelConn, sendWindow)
	}()

	err := <-errChannel
	cancel()
	if err != nil && websocket.CloseStatus(err) != websocket.StatusNormalClosure {
		return err
	}
	return nil
}

type sendWindowState struct {
	mutex sync.Mutex
	bytes int
}

func (state *sendWindowState) consume(bytes int) error {
	state.mutex.Lock()
	defer state.mutex.Unlock()
	if bytes > state.bytes {
		return errors.New("sandbox agent stream send window is exhausted; refusing to send another frame")
	}
	state.bytes -= bytes
	return nil
}

func (state *sendWindowState) add(bytes int) error {
	state.mutex.Lock()
	defer state.mutex.Unlock()
	next := state.bytes + bytes
	if next > agentStreamWindowBytes {
		return errors.New("sandbox agent stream send window exceeds the configured maximum")
	}
	state.bytes = next
	return nil
}

func relayCodexToTunnel(ctx context.Context, codexConn *websocket.Conn, tunnelConn *websocket.Conn, sendWindow *sendWindowState) error {
	for {
		messageType, payload, err := codexConn.Read(ctx)
		if err != nil {
			return sendStreamClose(ctx, tunnelConn)
		}
		payloadKind := payloadKindWebSocketBytes
		if messageType == websocket.MessageText {
			payloadKind = payloadKindWebSocketText
		}
		if err := sendWindow.consume(len(payload)); err != nil {
			return err
		}
		frame, err := encodeDataFrame(streamID, payloadKind, payload)
		if err != nil {
			return err
		}
		if err := tunnelConn.Write(ctx, websocket.MessageBinary, frame); err != nil {
			return fmt.Errorf("failed to write Mistle tunnel: %w", err)
		}
	}
}

func relayTunnelToCodex(ctx context.Context, codexConn *websocket.Conn, tunnelConn *websocket.Conn, sendWindow *sendWindowState) error {
	for {
		messageType, payload, err := tunnelConn.Read(ctx)
		if err != nil {
			_ = codexConn.Close(websocket.StatusNormalClosure, "")
			return nil
		}
		switch messageType {
		case websocket.MessageBinary:
			frame, err := decodeDataFrame(payload)
			if err != nil {
				return err
			}
			if frame.StreamID != streamID {
				return errors.New("received data frame for an unexpected stream id")
			}
			if err := sendStreamWindow(ctx, tunnelConn, len(frame.Payload)); err != nil {
				return err
			}
			switch frame.PayloadKind {
			case payloadKindWebSocketText:
				if err := codexConn.Write(ctx, websocket.MessageText, frame.Payload); err != nil {
					return fmt.Errorf("failed to write codex websocket: %w", err)
				}
			case payloadKindWebSocketBytes:
				if err := codexConn.Write(ctx, websocket.MessageBinary, frame.Payload); err != nil {
					return fmt.Errorf("failed to write codex websocket: %w", err)
				}
			default:
				return errors.New("received data frame with an unsupported payload kind")
			}
		case websocket.MessageText:
			var control streamControlMessage
			if err := json.Unmarshal(payload, &control); err != nil {
				return fmt.Errorf("failed to decode Mistle tunnel control message: %w", err)
			}
			if control.StreamID != streamID {
				return errors.New("received unsupported control message for the agent stream")
			}
			switch control.Type {
			case "stream.window":
				if err := sendWindow.add(control.Bytes); err != nil {
					return err
				}
			case "stream.reset", "stream.complete", "stream.close":
				_ = codexConn.Close(websocket.StatusNormalClosure, "")
				return nil
			default:
				return errors.New("received unsupported control message for the agent stream")
			}
		}
	}
}

func sendStreamWindow(ctx context.Context, tunnelConn *websocket.Conn, bytes int) error {
	if bytes == 0 {
		return nil
	}
	message, err := json.Marshal(streamControlMessage{
		Type:     "stream.window",
		StreamID: streamID,
		Bytes:    bytes,
	})
	if err != nil {
		return fmt.Errorf("failed to encode Mistle tunnel control message: %w", err)
	}
	if err := tunnelConn.Write(ctx, websocket.MessageText, message); err != nil {
		return fmt.Errorf("failed to write Mistle tunnel: %w", err)
	}
	return nil
}

func sendStreamClose(ctx context.Context, tunnelConn *websocket.Conn) error {
	message, err := json.Marshal(streamControlMessage{
		Type:     "stream.close",
		StreamID: streamID,
	})
	if err != nil {
		return fmt.Errorf("failed to encode Mistle tunnel control message: %w", err)
	}
	if err := tunnelConn.Write(ctx, websocket.MessageText, message); err != nil {
		return fmt.Errorf("failed to write Mistle tunnel: %w", err)
	}
	return nil
}

func codexCommandArgs(remoteURL string, codexArgs []string) ([]string, error) {
	if err := validateCodexArgs(codexArgs); err != nil {
		return nil, err
	}
	commandArgs := make([]string, 0, len(codexArgs)+6)
	if len(codexArgs) > 0 && (codexArgs[0] == "resume" || codexArgs[0] == "fork") {
		commandArgs = append(commandArgs, codexArgs[0])
		commandArgs = appendMistleCodexConfigArgs(commandArgs)
		commandArgs = append(commandArgs, "--remote", remoteURL)
		commandArgs = append(commandArgs, codexArgs[1:]...)
		return commandArgs, nil
	}
	commandArgs = appendMistleCodexConfigArgs(commandArgs)
	commandArgs = append(commandArgs, "--remote", remoteURL)
	commandArgs = append(commandArgs, codexArgs...)
	return commandArgs, nil
}

func appendMistleCodexConfigArgs(commandArgs []string) []string {
	commandArgs = append(commandArgs, "-c", fmt.Sprintf("model_provider=%s", tomlString(codexMistleModelProviderID)))
	commandArgs = append(commandArgs, "-c", codexMistleModelProviderConfig)
	return commandArgs
}

func createCodexHome() (string, error) {
	path, err := uniqueCodexHomePath()
	if err != nil {
		return "", err
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		return "", fmt.Errorf("failed to create temporary Codex home: %w", err)
	}
	config, err := renderLocalCodexConfig()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(path, "config.toml"), []byte(config), 0o600); err != nil {
		return "", fmt.Errorf("failed to write temporary Codex config.toml: %w", err)
	}
	return path, nil
}

func renderLocalCodexConfig() (string, error) {
	currentDir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to create temporary Codex home: %w", err)
	}
	projects := map[string]struct{}{currentDir: {}}
	if canonicalCurrentDir, err := filepath.EvalSymlinks(currentDir); err == nil {
		projects[canonicalCurrentDir] = struct{}{}
	}
	if gitRoot := gitCommonProjectRoot(currentDir); gitRoot != "" {
		projects[gitRoot] = struct{}{}
	}

	projectList := make([]string, 0, len(projects))
	for project := range projects {
		projectList = append(projectList, project)
	}
	sort.Strings(projectList)

	var builder strings.Builder
	builder.WriteString("approval_policy = \"never\"\nsandbox_mode = \"danger-full-access\"\n")
	for _, project := range projectList {
		builder.WriteString("\n[projects.")
		builder.WriteString(tomlString(project))
		builder.WriteString("]\ntrust_level = \"trusted\"\n")
	}
	return builder.String(), nil
}

func gitCommonProjectRoot(currentDir string) string {
	output, err := exec.Command("git", "-C", currentDir, "rev-parse", "--path-format=absolute", "--git-common-dir").Output()
	if err != nil {
		return ""
	}
	gitCommonDir := strings.TrimSpace(string(output))
	if filepath.Base(gitCommonDir) != ".git" {
		return ""
	}
	return filepath.Dir(gitCommonDir)
}

func tomlString(value string) string {
	var builder strings.Builder
	builder.WriteByte('"')
	for _, character := range value {
		switch character {
		case '\\':
			builder.WriteString("\\\\")
		case '"':
			builder.WriteString("\\\"")
		case '\n':
			builder.WriteString("\\n")
		case '\r':
			builder.WriteString("\\r")
		case '\t':
			builder.WriteString("\\t")
		default:
			builder.WriteRune(character)
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

func uniqueCodexHomePath() (string, error) {
	return filepath.Join(os.TempDir(), fmt.Sprintf("mistle-codex-home-%d-%d", os.Getpid(), time.Now().UnixNano())), nil
}

func encodeDataFrame(frameStreamID uint32, payloadKind byte, payload []byte) ([]byte, error) {
	if frameStreamID == 0 {
		return nil, errors.New("stream id must be greater than zero")
	}
	if payloadKind != payloadKindWebSocketText && payloadKind != payloadKindWebSocketBytes {
		return nil, errors.New("payload kind is not supported")
	}
	encoded := make([]byte, 6+len(payload))
	encoded[0] = dataFrameKind
	binary.BigEndian.PutUint32(encoded[1:5], frameStreamID)
	encoded[5] = payloadKind
	copy(encoded[6:], payload)
	return encoded, nil
}

func decodeDataFrame(encoded []byte) (streamDataFrame, error) {
	if len(encoded) < 6 {
		return streamDataFrame{}, errors.New("data frame must be at least 6 bytes long")
	}
	if encoded[0] != dataFrameKind {
		return streamDataFrame{}, errors.New("data frame kind is not supported")
	}
	frameStreamID := binary.BigEndian.Uint32(encoded[1:5])
	if frameStreamID == 0 {
		return streamDataFrame{}, errors.New("stream id must be greater than zero")
	}
	return streamDataFrame{
		StreamID:    frameStreamID,
		PayloadKind: encoded[5],
		Payload:     append([]byte(nil), encoded[6:]...),
	}, nil
}
