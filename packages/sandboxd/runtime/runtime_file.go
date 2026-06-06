package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	ManagedBlockStartMarker = "<!-- MISTLE-MANAGED:START mistle-sandbox-context -->"
	ManagedBlockEndMarker   = "<!-- MISTLE-MANAGED:END mistle-sandbox-context -->"
)

type RuntimeFileApplyOutcome string

const (
	RuntimeFileApplyOutcomeWritten         RuntimeFileApplyOutcome = "written"
	RuntimeFileApplyOutcomeSkippedIfAbsent RuntimeFileApplyOutcome = "skipped_if_absent"
)

func ApplyRuntimeFile(file RuntimeClientSetupFile) (RuntimeFileApplyOutcome, error) {
	parentDirectory := filepath.Dir(file.Path)
	if parentDirectory == "." || parentDirectory == "" {
		return "", fmt.Errorf("runtime file path %s has no parent directory", file.Path)
	}
	if err := os.MkdirAll(parentDirectory, 0o755); err != nil {
		return "", fmt.Errorf("failed to create parent directory %s: %w", parentDirectory, err)
	}

	if file.WriteMode != nil && *file.WriteMode == RuntimeFileWriteModeIfAbsent {
		if _, err := os.Stat(file.Path); err == nil {
			return RuntimeFileApplyOutcomeSkippedIfAbsent, nil
		} else if !os.IsNotExist(err) {
			return "", fmt.Errorf("failed to inspect file %s: %w", file.Path, err)
		}
	}

	content := file.Content
	if file.WriteMode != nil && *file.WriteMode == RuntimeFileWriteModeMerge {
		mergedContent, err := mergeRuntimeFile(file)
		if err != nil {
			return "", err
		}
		content = mergedContent
	}

	if err := os.WriteFile(file.Path, []byte(content), os.FileMode(file.Mode)); err != nil {
		return "", fmt.Errorf("failed to write file %s: %w", file.Path, err)
	}
	if err := os.Chmod(file.Path, os.FileMode(file.Mode)); err != nil {
		return "", fmt.Errorf("failed to set file mode for %s: %w", file.Path, err)
	}
	return RuntimeFileApplyOutcomeWritten, nil
}

func mergeRuntimeFile(file RuntimeClientSetupFile) (string, error) {
	existingContentBytes, err := os.ReadFile(file.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return file.Content, nil
		}
		return "", fmt.Errorf("failed to read file %s: %w", file.Path, err)
	}
	existingContent := string(existingContentBytes)

	if containsManagedBlock(file.Content) {
		return mergeManagedBlock(existingContent, file.Content), nil
	}
	if mergedJSON, ok, err := tryMergeJSONFile(file, existingContent); err != nil || ok {
		return mergedJSON, err
	}
	if looksLikeTOML(file.Path, file.Content) {
		return mergeTOMLFile(existingContent, file.Content), nil
	}
	return "", fmt.Errorf(
		"runtime file %s uses writeMode merge, but sandboxd could not infer a supported merge format",
		file.Path,
	)
}

func containsManagedBlock(content string) bool {
	return strings.Contains(content, ManagedBlockStartMarker) && strings.Contains(content, ManagedBlockEndMarker)
}

func tryMergeJSONFile(file RuntimeClientSetupFile, existingContent string) (string, bool, error) {
	var generatedJSON any
	if err := json.Unmarshal([]byte(file.Content), &generatedJSON); err != nil {
		if strings.HasSuffix(file.Path, ".json") {
			return "", false, fmt.Errorf(
				"runtime file %s uses writeMode merge for JSON, but generated content is invalid JSON: %w",
				file.Path,
				err,
			)
		}
		return "", false, nil
	}
	generatedObject, ok := generatedJSON.(map[string]any)
	if !ok {
		return "", false, fmt.Errorf(
			"runtime file %s uses writeMode merge for JSON, but generated content is not a JSON object",
			file.Path,
		)
	}

	var existingJSON any
	if err := json.Unmarshal([]byte(existingContent), &existingJSON); err != nil {
		return "", false, fmt.Errorf(
			"runtime file %s uses writeMode merge for JSON, but existing content is invalid JSON: %w",
			file.Path,
			err,
		)
	}
	existingObject, ok := existingJSON.(map[string]any)
	if !ok {
		return "", false, fmt.Errorf(
			"runtime file %s uses writeMode merge for JSON, but existing content is not a JSON object",
			file.Path,
		)
	}
	mergeJSONObject(existingObject, generatedObject, "")
	mergedJSON, err := json.MarshalIndent(existingObject, "", "  ")
	if err != nil {
		return "", false, fmt.Errorf("failed to serialize merged JSON for %s: %w", file.Path, err)
	}
	return ensureTrailingNewline(string(mergedJSON)), true, nil
}

func mergeJSONObject(existing map[string]any, generated map[string]any, parentKey string) {
	for key, generatedValue := range generated {
		if isMCPServersKey(parentKey) {
			existing[key] = generatedValue
			continue
		}
		existingValue, ok := existing[key]
		if !ok {
			existing[key] = generatedValue
			continue
		}
		if key == "extensions" {
			existing[key] = mergeJSONArray(existingValue, generatedValue)
			continue
		}
		existingChild, existingOK := existingValue.(map[string]any)
		generatedChild, generatedOK := generatedValue.(map[string]any)
		if existingOK && generatedOK {
			mergeJSONObject(existingChild, generatedChild, key)
			continue
		}
		existing[key] = generatedValue
	}
}

func mergeJSONArray(existingValue any, generatedValue any) any {
	existingArray, existingOK := existingValue.([]any)
	generatedArray, generatedOK := generatedValue.([]any)
	if !existingOK || !generatedOK {
		return generatedValue
	}
	for _, generatedItem := range generatedArray {
		if !jsonArrayContains(existingArray, generatedItem) {
			existingArray = append(existingArray, generatedItem)
		}
	}
	return existingArray
}

func jsonArrayContains(items []any, target any) bool {
	targetBytes, targetErr := json.Marshal(target)
	if targetErr != nil {
		return false
	}
	for _, item := range items {
		itemBytes, itemErr := json.Marshal(item)
		if itemErr == nil && string(itemBytes) == string(targetBytes) {
			return true
		}
	}
	return false
}

func isMCPServersKey(key string) bool {
	return key == "mcp" || key == "mcpServers" || key == "mcp_servers"
}

func mergeManagedBlock(existingContent string, replacementContent string) string {
	startIndex := strings.Index(existingContent, ManagedBlockStartMarker)
	if startIndex >= 0 {
		searchStart := startIndex + len(ManagedBlockStartMarker)
		relativeEndIndex := strings.Index(existingContent[searchStart:], ManagedBlockEndMarker)
		if relativeEndIndex >= 0 {
			endIndex := searchStart + relativeEndIndex + len(ManagedBlockEndMarker)
			return ensureTrailingNewline(existingContent[:startIndex] + trimTrailingNewlines(replacementContent) + existingContent[endIndex:])
		}
	}
	merged := ensureTrailingNewline(existingContent)
	if !strings.HasSuffix(merged, "\n\n") {
		merged += "\n"
	}
	return merged + trimTrailingNewlines(replacementContent) + "\n"
}

func looksLikeTOML(path string, content string) bool {
	if strings.HasSuffix(path, ".toml") {
		return true
	}
	for _, line := range splitLinesWithEndings(content) {
		if tomlSectionName(line) != "" {
			return true
		}
	}
	return false
}

func mergeTOMLFile(existingContent string, generatedContent string) string {
	merged := existingContent
	for _, line := range generatedTOMLRootKeyLines(generatedContent) {
		key := tomlKeyName(line)
		if key != "" {
			merged = ensureTOMLRootKey(merged, key, trimTrailingNewlines(line))
		}
	}
	for _, sectionName := range generatedTOMLSectionNames(generatedContent) {
		section := extractTOMLSection(generatedContent, sectionName)
		if section == "" {
			continue
		}
		if isMCPServerSection(sectionName) {
			merged = replaceOrAppendTOMLSection(merged, sectionName, section)
			continue
		}
		sectionLines := generatedTOMLSectionKeyLines(section)
		if len(sectionLines) == 0 {
			merged = replaceOrAppendTOMLSection(merged, sectionName, section)
			continue
		}
		for _, line := range sectionLines {
			key := tomlKeyName(line)
			if key != "" {
				merged = ensureTOMLSectionKey(merged, sectionName, key, trimTrailingNewlines(line))
			}
		}
	}
	return ensureTrailingNewline(merged)
}

func generatedTOMLRootKeyLines(content string) []string {
	lines := []string{}
	for _, line := range splitLinesWithEndings(content) {
		if tomlSectionName(line) != "" {
			break
		}
		if tomlKeyName(line) != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func generatedTOMLSectionNames(content string) []string {
	sectionNames := []string{}
	seen := map[string]bool{}
	for _, line := range splitLinesWithEndings(content) {
		sectionName := tomlSectionName(line)
		if sectionName != "" && !seen[sectionName] {
			seen[sectionName] = true
			sectionNames = append(sectionNames, sectionName)
		}
	}
	return sectionNames
}

func generatedTOMLSectionKeyLines(section string) []string {
	lines := []string{}
	for _, line := range splitLinesWithEndings(section) {
		if tomlKeyName(line) != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func isMCPServerSection(sectionName string) bool {
	return strings.HasPrefix(sectionName, "mcp_servers.") || strings.HasPrefix(sectionName, "mcpServers.")
}

func extractTOMLSection(content string, sectionName string) string {
	lines := splitLinesWithEndings(content)
	startIndex := -1
	for index, line := range lines {
		if tomlSectionName(line) == sectionName {
			startIndex = index
			break
		}
	}
	if startIndex < 0 {
		return ""
	}
	endIndex := len(lines)
	for index := startIndex + 1; index < len(lines); index++ {
		if tomlSectionName(lines[index]) != "" {
			endIndex = index
			break
		}
	}
	return ensureTrailingNewline(strings.Join(lines[startIndex:endIndex], ""))
}

func ensureTOMLSectionKey(content string, sectionName string, key string, line string) string {
	lines := splitLinesWithEndings(content)
	startIndex := -1
	for index, candidate := range lines {
		if tomlSectionName(candidate) == sectionName {
			startIndex = index
			break
		}
	}
	if startIndex < 0 {
		output := ensureTrailingNewline(content)
		if !strings.HasSuffix(output, "\n\n") {
			output += "\n"
		}
		return output + "[" + sectionName + "]\n" + line + "\n"
	}
	endIndex := nextTOMLSectionIndex(lines, startIndex+1)
	for index := startIndex + 1; index < endIndex; index++ {
		if tomlKeyName(lines[index]) == key {
			lines[index] = line + "\n"
			return strings.Join(lines, "")
		}
	}
	lines = append(lines[:endIndex], append([]string{line + "\n"}, lines[endIndex:]...)...)
	return strings.Join(lines, "")
}

func ensureTOMLRootKey(content string, key string, line string) string {
	lines := splitLinesWithEndings(content)
	firstSectionIndex := nextTOMLSectionIndex(lines, 0)
	for index := 0; index < firstSectionIndex; index++ {
		if tomlKeyName(lines[index]) == key {
			lines[index] = line + "\n"
			return strings.Join(lines, "")
		}
	}
	lines = append(lines[:firstSectionIndex], append([]string{line + "\n"}, lines[firstSectionIndex:]...)...)
	return strings.Join(lines, "")
}

func replaceOrAppendTOMLSection(content string, sectionName string, replacement string) string {
	lines := splitLinesWithEndings(content)
	startIndex := -1
	for index, candidate := range lines {
		if tomlSectionName(candidate) == sectionName {
			startIndex = index
			break
		}
	}
	if startIndex < 0 {
		output := ensureTrailingNewline(content)
		if !strings.HasSuffix(output, "\n\n") {
			output += "\n"
		}
		return output + trimTrailingNewlines(replacement) + "\n"
	}
	endIndex := nextTOMLSectionIndex(lines, startIndex+1)
	replacementLines := splitLinesWithEndings(replacement)
	lines = append(lines[:startIndex], append(replacementLines, lines[endIndex:]...)...)
	return strings.Join(lines, "")
}

func nextTOMLSectionIndex(lines []string, startIndex int) int {
	for index := startIndex; index < len(lines); index++ {
		if tomlSectionName(lines[index]) != "" {
			return index
		}
	}
	return len(lines)
}

func splitLinesWithEndings(content string) []string {
	if content == "" {
		return nil
	}
	sourceLines := strings.SplitAfter(content, "\n")
	if sourceLines[len(sourceLines)-1] == "" {
		sourceLines = sourceLines[:len(sourceLines)-1]
	}
	lines := make([]string, 0, len(sourceLines))
	for _, line := range sourceLines {
		if strings.HasSuffix(line, "\n") {
			lines = append(lines, line)
		} else {
			lines = append(lines, line+"\n")
		}
	}
	return lines
}

func tomlSectionName(line string) string {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "[") || !strings.HasSuffix(trimmed, "]") || strings.HasPrefix(trimmed, "[[") {
		return ""
	}
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "["), "]"))
}

func tomlKeyName(line string) string {
	trimmed := strings.TrimLeft(line, " \t")
	if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "[") {
		return ""
	}
	key, _, ok := strings.Cut(trimmed, "=")
	if !ok {
		return ""
	}
	return strings.TrimSpace(key)
}

func trimTrailingNewlines(content string) string {
	return strings.TrimRight(content, "\r\n")
}

func ensureTrailingNewline(content string) string {
	if strings.HasSuffix(content, "\n") {
		return content
	}
	return content + "\n"
}
