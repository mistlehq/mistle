package piproxy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const PiSessionDirEnv = "PI_CODING_AGENT_SESSION_DIR"

type Conversation struct {
	CreatedAt *string
	CWD       *string
	ID        string
	Modified  time.Time
	Path      string
	Title     *string
}

type sessionHeader struct {
	Type        string  `json:"type"`
	ID          string  `json:"id"`
	Timestamp   *string `json:"timestamp"`
	CWD         *string `json:"cwd"`
	SessionName *string `json:"sessionName"`
	Title       *string `json:"title"`
}

func FindRecentConversation(env map[string]string, cwd *string) (*Conversation, error) {
	conversations, err := collectSessionCandidates(env, cwd)
	if err != nil {
		return nil, err
	}
	if len(conversations) == 0 {
		return nil, nil
	}
	return &conversations[0], nil
}

func FindConversationByID(env map[string]string, providerConversationID string) (Conversation, error) {
	conversations, err := collectSessionCandidates(env, nil)
	if err != nil {
		return Conversation{}, err
	}
	for _, conversation := range conversations {
		if conversation.ID == providerConversationID {
			return conversation, nil
		}
	}
	return Conversation{}, fmt.Errorf("Pi conversation %q was not found", providerConversationID)
}

func ListConversations(env map[string]string, cwd *string, limit int) (map[string]any, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("limit must be greater than zero")
	}
	conversations, err := collectSessionCandidates(env, cwd)
	if err != nil {
		return nil, err
	}
	filtered := make([]Conversation, 0, len(conversations))
	for _, conversation := range conversations {
		if conversation.CWD != nil {
			filtered = append(filtered, conversation)
		}
	}
	hasMore := len(filtered) > limit
	if len(filtered) > limit {
		filtered = filtered[:limit]
	}
	items := make([]map[string]any, 0, len(filtered))
	for _, conversation := range filtered {
		items = append(items, map[string]any{
			"id":          conversation.ID,
			"sessionFile": conversation.Path,
			"cwd":         *conversation.CWD,
			"title":       stringPointerValue(conversation.Title),
			"createdAt":   stringPointerValue(conversation.CreatedAt),
			"updatedAt":   conversation.Modified.UnixMilli(),
		})
	}
	return map[string]any{
		"conversations": items,
		"hasMore":       hasMore,
	}, nil
}

func collectSessionCandidates(env map[string]string, cwd *string) ([]Conversation, error) {
	sessionDir, ok := env[PiSessionDirEnv]
	if !ok || sessionDir == "" {
		return nil, fmt.Errorf("Pi runtime client setup must define PI_CODING_AGENT_SESSION_DIR")
	}
	var conversations []Conversation
	err := filepath.WalkDir(sessionDir, func(path string, directoryEntry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) && path != sessionDir {
				return nil
			}
			return walkErr
		}
		if directoryEntry.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".jsonl" {
			return nil
		}
		header, ok := readSessionHeader(path)
		if !ok {
			return nil
		}
		if cwd != nil && (header.CWD == nil || *header.CWD != *cwd) {
			return nil
		}
		info, err := directoryEntry.Info()
		if err != nil {
			return err
		}
		title := header.SessionName
		if title == nil {
			title = header.Title
		}
		conversations = append(conversations, Conversation{
			CreatedAt: header.Timestamp,
			CWD:       header.CWD,
			ID:        header.ID,
			Modified:  info.ModTime(),
			Path:      path,
			Title:     title,
		})
		return nil
	})
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sort.Slice(conversations, func(left int, right int) bool {
		return conversations[left].Modified.After(conversations[right].Modified)
	})
	return conversations, nil
}

func readSessionHeader(path string) (sessionHeader, bool) {
	file, err := os.Open(path)
	if err != nil {
		return sessionHeader{}, false
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return sessionHeader{}, false
	}
	var header sessionHeader
	if err := json.Unmarshal(scanner.Bytes(), &header); err != nil {
		return sessionHeader{}, false
	}
	if header.Type != "session" || header.ID == "" {
		return sessionHeader{}, false
	}
	return header, true
}

func stringPointerValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
