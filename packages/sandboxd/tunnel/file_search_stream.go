package tunnel

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	defaultFileSearchLimit = 50
	maxFileSearchLimit     = 100
)

func SearchFiles(channel tunnelprotocol.StreamChannel, query tunnelprotocol.FileSearchQuery) ([]tunnelprotocol.FileSearchResultItem, error) {
	root, err := FileSearchRoot(channel)
	if err != nil {
		return nil, err
	}

	limit := fileSearchLimit(query)
	matches := make([]fileSearchMatch, 0, limit)
	normalizedQuery := strings.ToLower(strings.TrimSpace(query.Query))
	err = filepath.WalkDir(root, func(path string, directoryEntry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relativePath = filepath.ToSlash(relativePath)
		if relativePath == "." {
			return nil
		}
		score, ok := fileSearchPathScore(relativePath, normalizedQuery, directoryEntry.IsDir())
		if !ok {
			return nil
		}
		kind := "file"
		if directoryEntry.IsDir() {
			kind = "directory"
		}
		matches = append(matches, fileSearchMatch{
			item:  tunnelprotocol.FileSearchResultItem{Path: relativePath, Kind: kind},
			score: score,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("file search failed: %w", err)
	}
	sort.Slice(matches, func(leftIndex int, rightIndex int) bool {
		left := matches[leftIndex]
		right := matches[rightIndex]
		if left.score != right.score {
			return left.score < right.score
		}
		return left.item.Path < right.item.Path
	})
	if len(matches) > limit {
		matches = matches[:limit]
	}
	items := make([]tunnelprotocol.FileSearchResultItem, 0, len(matches))
	for _, match := range matches {
		items = append(items, match.item)
	}
	return items, nil
}

func FileSearchRoot(channel tunnelprotocol.StreamChannel) (string, error) {
	if channel.CWD == nil || *channel.CWD == "" {
		return "", fmt.Errorf("file search cwd is required")
	}
	root, err := filepath.EvalSymlinks(*channel.CWD)
	if err != nil {
		return "", fmt.Errorf("failed to resolve file search cwd %s: %w", *channel.CWD, err)
	}
	rootInfo, err := os.Stat(root)
	if err != nil {
		return "", fmt.Errorf("failed to inspect file search cwd %s: %w", root, err)
	}
	if !rootInfo.IsDir() {
		return "", fmt.Errorf("file search cwd %s is not a directory", root)
	}
	return root, nil
}

type fileSearchMatch struct {
	item  tunnelprotocol.FileSearchResultItem
	score int
}

func fileSearchLimit(query tunnelprotocol.FileSearchQuery) int {
	if query.Limit == nil {
		return defaultFileSearchLimit
	}
	if *query.Limit > maxFileSearchLimit {
		return maxFileSearchLimit
	}
	return int(*query.Limit)
}

func fileSearchScore(path string, normalizedQuery string) (int, bool) {
	if normalizedQuery == "" {
		return 0, true
	}
	normalizedPath := strings.ToLower(path)
	index := strings.Index(normalizedPath, normalizedQuery)
	if index >= 0 {
		return index, true
	}
	queryIndex := 0
	firstIndex := -1
	lastIndex := -1
	for pathIndex, character := range normalizedPath {
		if queryIndex >= len(normalizedQuery) {
			break
		}
		if byte(character) == normalizedQuery[queryIndex] {
			if firstIndex == -1 {
				firstIndex = pathIndex
			}
			lastIndex = pathIndex
			queryIndex++
		}
	}
	if queryIndex != len(normalizedQuery) {
		return 0, false
	}
	return 1000 + lastIndex - firstIndex, true
}

func fileSearchPathScore(path string, normalizedQuery string, isDirectory bool) (int, bool) {
	score, ok := fileSearchScore(path, normalizedQuery)
	if ok || !isDirectory {
		return score, ok
	}
	return fileSearchScore(path+"/", normalizedQuery)
}
