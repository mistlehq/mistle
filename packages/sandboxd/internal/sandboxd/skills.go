package sandboxd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"go.yaml.in/yaml/v4"
)

const skillFileName = "SKILL.md"

type SkillsDiscoverOutput struct {
	CommitSHA string            `json:"commitSha"`
	Skills    []DiscoveredSkill `json:"skills"`
}

type DiscoveredSkill struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	RelativePath string `json:"relativePath"`
}

type SkillsCommandKind string

const (
	SkillsCommandDiscover  SkillsCommandKind = "discover"
	SkillsCommandReconcile SkillsCommandKind = "reconcile"
)

type SkillsCommand struct {
	Kind     SkillsCommandKind
	RepoRoot string
}

func RunSkills(args []string, stdout io.Writer) error {
	command, err := ParseSkillsCommand(args)
	if err != nil {
		return err
	}
	switch command.Kind {
	case SkillsCommandDiscover:
		return RunSkillsDiscover(command.RepoRoot, stdout)
	case SkillsCommandReconcile:
		return fmt.Errorf("sandboxd skills reconcile is not ported to Go yet")
	default:
		return fmt.Errorf("unknown parsed sandboxd skills command: %s", command.Kind)
	}
}

func ParseSkillsCommand(args []string) (SkillsCommand, error) {
	if len(args) == 0 {
		return SkillsCommand{}, fmt.Errorf("sandboxd skills requires a subcommand (expected 'discover' or 'reconcile')")
	}
	switch args[0] {
	case "discover":
		return parseSkillsDiscoverArgs(args[1:])
	case "reconcile":
		return parseSkillsReconcileArgs(args[1:])
	default:
		return SkillsCommand{}, fmt.Errorf("unknown sandboxd skills subcommand '%s' (expected 'discover' or 'reconcile')", args[0])
	}
}

func parseSkillsDiscoverArgs(args []string) (SkillsCommand, error) {
	repoRoot := ""
	for index := 0; index < len(args); index++ {
		argument := args[index]
		switch argument {
		case "--repo":
			if repoRoot != "" {
				return SkillsCommand{}, fmt.Errorf("unexpected sandboxd skills argument: %s", argument)
			}
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills requires --repo <path>")
			}
			repoRoot = args[index]
		default:
			return SkillsCommand{}, fmt.Errorf("unexpected sandboxd skills argument: %s", argument)
		}
	}
	if repoRoot == "" {
		return SkillsCommand{}, fmt.Errorf("sandboxd skills requires --repo <path>")
	}
	return SkillsCommand{Kind: SkillsCommandDiscover, RepoRoot: repoRoot}, nil
}

func parseSkillsReconcileArgs(args []string) (SkillsCommand, error) {
	repoRoot := ""
	for index := 0; index < len(args); index++ {
		argument := args[index]
		switch argument {
		case "--repo":
			if repoRoot != "" {
				return SkillsCommand{}, fmt.Errorf("unexpected sandboxd skills argument: %s", argument)
			}
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills requires --repo <path>")
			}
			repoRoot = args[index]
		case "--runtime":
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills reconcile requires --runtime <id>")
			}
			switch args[index] {
			case "codex", "opencode", "pi":
			default:
				return SkillsCommand{}, fmt.Errorf("unknown skills runtime '%s'", args[index])
			}
		case "--skill":
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills reconcile --skill requires a relative path value")
			}
		case "--target-root":
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills reconcile --target-root requires a path value")
			}
		default:
			return SkillsCommand{}, fmt.Errorf("unexpected sandboxd skills argument: %s", argument)
		}
	}
	if repoRoot == "" {
		return SkillsCommand{}, fmt.Errorf("sandboxd skills requires --repo <path>")
	}
	return SkillsCommand{Kind: SkillsCommandReconcile, RepoRoot: repoRoot}, nil
}

func RunSkillsDiscover(repoRoot string, stdout io.Writer) error {
	output, err := DiscoverSkills(repoRoot)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(stdout)
	if err := encoder.Encode(output); err != nil {
		return fmt.Errorf("failed to serialize skill discovery output: %w", err)
	}
	return nil
}

func DiscoverSkills(repoRoot string) (SkillsDiscoverOutput, error) {
	canonicalRepoRoot, err := canonicalizeRepoRoot(repoRoot)
	if err != nil {
		return SkillsDiscoverOutput{}, err
	}
	commitSHA, err := readGitCommitSHA(canonicalRepoRoot)
	if err != nil {
		return SkillsDiscoverOutput{}, err
	}
	skillFiles, err := collectSkillFiles(canonicalRepoRoot)
	if err != nil {
		return SkillsDiscoverOutput{}, err
	}
	sort.Strings(skillFiles)

	skills := make([]DiscoveredSkill, 0, len(skillFiles))
	namesToPaths := make(map[string]string, len(skillFiles))
	for _, skillFilePath := range skillFiles {
		skill, err := readSkillFile(canonicalRepoRoot, skillFilePath)
		if err != nil {
			return SkillsDiscoverOutput{}, err
		}
		if firstPath, ok := namesToPaths[skill.Name]; ok {
			return SkillsDiscoverOutput{}, fmt.Errorf("duplicate skill name '%s' discovered at '%s' and '%s'", skill.Name, firstPath, skill.RelativePath)
		}
		namesToPaths[skill.Name] = skill.RelativePath
		skills = append(skills, skill)
	}
	sort.Slice(skills, func(leftIndex, rightIndex int) bool {
		return skills[leftIndex].Name < skills[rightIndex].Name
	})

	return SkillsDiscoverOutput{
		CommitSHA: commitSHA,
		Skills:    skills,
	}, nil
}

func canonicalizeRepoRoot(repoRoot string) (string, error) {
	absoluteRepoRoot, err := filepath.Abs(repoRoot)
	if err != nil {
		return "", fmt.Errorf("failed to resolve repo root %s: %w", repoRoot, err)
	}
	canonicalRepoRoot, err := filepath.EvalSymlinks(absoluteRepoRoot)
	if err != nil {
		return "", fmt.Errorf("failed to resolve repo root %s: %w", repoRoot, err)
	}
	stat, err := os.Stat(canonicalRepoRoot)
	if err != nil {
		return "", fmt.Errorf("failed to resolve repo root %s: %w", repoRoot, err)
	}
	if !stat.IsDir() {
		return "", fmt.Errorf("repo root %s is not a directory", canonicalRepoRoot)
	}
	return canonicalRepoRoot, nil
}

func collectSkillFiles(directory string) ([]string, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory %s: %w", directory, err)
	}
	var skillFiles []string
	for _, entry := range entries {
		if entry.Name() == ".git" {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		entryType, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("failed to read directory %s: %w", directory, err)
		}
		if entryType.IsDir() {
			childSkillFiles, err := collectSkillFiles(path)
			if err != nil {
				return nil, err
			}
			skillFiles = append(skillFiles, childSkillFiles...)
			continue
		}
		if entryType.Mode().IsRegular() && entry.Name() == skillFileName {
			skillFiles = append(skillFiles, path)
		}
	}
	return skillFiles, nil
}

func readSkillFile(repoRoot string, skillFilePath string) (DiscoveredSkill, error) {
	content, err := os.ReadFile(skillFilePath)
	if err != nil {
		return DiscoveredSkill{}, fmt.Errorf("failed to read skill file %s: %w", skillFilePath, err)
	}
	frontmatter, err := parseSkillFrontmatter(skillFilePath, string(content))
	if err != nil {
		return DiscoveredSkill{}, err
	}
	name, err := readRequiredFrontmatterField(skillFilePath, frontmatter, "name")
	if err != nil {
		return DiscoveredSkill{}, err
	}
	if !isValidSkillName(name) {
		return DiscoveredSkill{}, fmt.Errorf("skill file %s has invalid skill name '%s'", skillFilePath, name)
	}
	description, err := readRequiredFrontmatterField(skillFilePath, frontmatter, "description")
	if err != nil {
		return DiscoveredSkill{}, err
	}
	skillDirectory := filepath.Dir(skillFilePath)
	relativePath, err := repoRelativePath(repoRoot, skillDirectory)
	if err != nil {
		return DiscoveredSkill{}, err
	}
	return DiscoveredSkill{
		Name:         name,
		Description:  description,
		RelativePath: relativePath,
	}, nil
}

func parseSkillFrontmatter(skillFilePath string, content string) (map[string]any, error) {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSuffix(lines[0], "\r") != "---" {
		return nil, fmt.Errorf("skill file %s must begin with YAML frontmatter", skillFilePath)
	}

	var frontmatter strings.Builder
	for _, rawLine := range lines[1:] {
		line := strings.TrimSuffix(rawLine, "\r")
		if line == "---" {
			fields := map[string]any{}
			if err := yaml.Unmarshal([]byte(frontmatter.String()), &fields); err != nil {
				return nil, fmt.Errorf("skill file %s has invalid YAML frontmatter: %w", skillFilePath, err)
			}
			if len(fields) == 0 {
				return nil, fmt.Errorf("skill file %s must use a YAML mapping for frontmatter", skillFilePath)
			}
			return fields, nil
		}
		frontmatter.WriteString(line)
		frontmatter.WriteByte('\n')
	}
	return nil, fmt.Errorf("skill file %s has unterminated YAML frontmatter", skillFilePath)
}

func readRequiredFrontmatterField(skillFilePath string, frontmatter map[string]any, field string) (string, error) {
	value, ok := frontmatter[field]
	if !ok {
		return "", fmt.Errorf("skill file %s is missing required frontmatter field '%s'", skillFilePath, field)
	}
	stringValue, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("skill file %s frontmatter field '%s' must be a string", skillFilePath, field)
	}
	trimmedValue := strings.TrimSpace(stringValue)
	if trimmedValue == "" {
		return "", fmt.Errorf("skill file %s is missing required frontmatter field '%s'", skillFilePath, field)
	}
	return trimmedValue, nil
}

func isValidSkillName(name string) bool {
	if name == "" || strings.HasPrefix(name, "-") || strings.HasSuffix(name, "-") {
		return false
	}
	previousWasDash := false
	for _, character := range name {
		validCharacter := character >= 'a' && character <= 'z' || character >= '0' && character <= '9' || character == '-'
		if !validCharacter {
			return false
		}
		if character == '-' {
			if previousWasDash {
				return false
			}
			previousWasDash = true
			continue
		}
		previousWasDash = false
	}
	return true
}

func repoRelativePath(repoRoot string, path string) (string, error) {
	relativePath, err := filepath.Rel(repoRoot, path)
	if err != nil {
		return "", fmt.Errorf("skill path %s could not be represented relative to the repo root", path)
	}
	if relativePath == "." {
		return ".", nil
	}
	if strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) || relativePath == ".." || filepath.IsAbs(relativePath) {
		return "", fmt.Errorf("skill path %s could not be represented relative to the repo root", path)
	}
	return filepath.ToSlash(relativePath), nil
}

func readGitCommitSHA(repoRoot string) (string, error) {
	command := exec.Command("git", "-C", repoRoot, "rev-parse", "HEAD")
	output, err := command.Output()
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("failed to read git commit SHA for repo %s: %s", repoRoot, strings.TrimSpace(string(exitError.Stderr)))
		}
		return "", fmt.Errorf("failed to read git commit SHA for repo %s: %w", repoRoot, err)
	}
	return strings.TrimSpace(string(output)), nil
}
