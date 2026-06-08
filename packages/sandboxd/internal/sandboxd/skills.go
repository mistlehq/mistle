package sandboxd

import (
	"encoding/json"
	"errors"
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
const agentSkillsTargetRoot = "/root/.agents/skills"
const managedSkillsManifestFileName = ".mistle-managed-skills.json"
const managedSkillsManifestVersion = 1

type SkillsDiscoverOutput struct {
	CommitSHA string            `json:"commitSha"`
	Skills    []DiscoveredSkill `json:"skills"`
}

type DiscoveredSkill struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	RelativePath string `json:"relativePath"`
}

type SkillsReconcileOutput struct {
	Runtime    string            `json:"runtime"`
	TargetRoot string            `json:"targetRoot"`
	Skills     []ReconciledSkill `json:"skills"`
}

type ReconciledSkill struct {
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
	SourcePath   string `json:"sourcePath"`
	TargetPath   string `json:"targetPath"`
}

type SkillsReconcileSelection struct {
	Name         string
	RelativePath string
}

type SkillsCommandKind string

const (
	SkillsCommandDiscover  SkillsCommandKind = "discover"
	SkillsCommandReconcile SkillsCommandKind = "reconcile"
)

type SkillsCommand struct {
	Kind                  SkillsCommandKind
	RepoRoot              string
	Runtime               string
	SelectedRelativePaths []string
	TargetRootOverride    string
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
		return RunSkillsReconcile(
			command.RepoRoot,
			command.Runtime,
			command.SelectedRelativePaths,
			command.TargetRootOverride,
			stdout,
		)
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
	runtime := ""
	selectedRelativePaths := []string{}
	targetRootOverride := ""
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
			if runtime != "" {
				return SkillsCommand{}, fmt.Errorf("unexpected sandboxd skills argument: %s", argument)
			}
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills reconcile requires --runtime <id>")
			}
			runtime = args[index]
			if err := validateSkillsRuntime(runtime); err != nil {
				return SkillsCommand{}, err
			}
		case "--skill":
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills reconcile --skill requires a relative path value")
			}
			selectedRelativePaths = append(selectedRelativePaths, args[index])
		case "--target-root":
			if targetRootOverride != "" {
				return SkillsCommand{}, fmt.Errorf("unexpected sandboxd skills argument: %s", argument)
			}
			index++
			if index >= len(args) {
				return SkillsCommand{}, fmt.Errorf("sandboxd skills reconcile --target-root requires a path value")
			}
			targetRootOverride = args[index]
		default:
			return SkillsCommand{}, fmt.Errorf("unexpected sandboxd skills argument: %s", argument)
		}
	}
	if repoRoot == "" {
		return SkillsCommand{}, fmt.Errorf("sandboxd skills requires --repo <path>")
	}
	if runtime == "" {
		return SkillsCommand{}, fmt.Errorf("sandboxd skills reconcile requires --runtime <id>")
	}
	return SkillsCommand{
		Kind:                  SkillsCommandReconcile,
		RepoRoot:              repoRoot,
		Runtime:               runtime,
		SelectedRelativePaths: selectedRelativePaths,
		TargetRootOverride:    targetRootOverride,
	}, nil
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

func RunSkillsReconcile(
	repoRoot string,
	runtime string,
	selectedRelativePaths []string,
	targetRootOverride string,
	stdout io.Writer,
) error {
	output, err := ReconcileSkills(repoRoot, runtime, selectedRelativePaths, targetRootOverride)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(stdout)
	if err := encoder.Encode(output); err != nil {
		return fmt.Errorf("failed to serialize skill reconcile output: %w", err)
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

func ReconcileSkills(
	repoRoot string,
	runtime string,
	selectedRelativePaths []string,
	targetRootOverride string,
) (SkillsReconcileOutput, error) {
	requests := make([]skillsReconcileRequest, 0, len(selectedRelativePaths))
	for _, selectedRelativePath := range selectedRelativePaths {
		requests = append(requests, skillsReconcileRequest{RelativePath: selectedRelativePath})
	}
	return reconcileSkillsWithOptions(repoRoot, runtime, requests, targetRootOverride, true, skillsTargetOwnershipAllEntries)
}

func ReconcileMaterializedSkills(
	repoRoot string,
	runtime string,
	selections []SkillsReconcileSelection,
	targetRootOverride string,
) (SkillsReconcileOutput, error) {
	requests := make([]skillsReconcileRequest, 0, len(selections))
	for _, selection := range selections {
		expectedName := selection.Name
		requests = append(requests, skillsReconcileRequest{
			ExpectedName: &expectedName,
			RelativePath: selection.RelativePath,
		})
	}
	return reconcileSkillsWithOptions(repoRoot, runtime, requests, targetRootOverride, false, skillsTargetOwnershipManagedSymlinks)
}

type skillsTargetOwnership string

const (
	skillsTargetOwnershipAllEntries      skillsTargetOwnership = "all_entries"
	skillsTargetOwnershipManagedSymlinks skillsTargetOwnership = "managed_symlinks"
)

func reconcileSkillsWithOptions(
	repoRoot string,
	runtime string,
	selections []skillsReconcileRequest,
	targetRootOverride string,
	pullRepo bool,
	targetOwnership skillsTargetOwnership,
) (SkillsReconcileOutput, error) {
	if err := validateSkillsRuntime(runtime); err != nil {
		return SkillsReconcileOutput{}, err
	}
	canonicalRepoRoot, err := canonicalizeRepoRoot(repoRoot)
	if err != nil {
		return SkillsReconcileOutput{}, err
	}
	targetRoot := targetRootOverride
	if targetRoot == "" {
		targetRoot = agentSkillsTargetRoot
	}

	if pullRepo {
		if err := pullGitRepo(canonicalRepoRoot); err != nil {
			return SkillsReconcileOutput{}, err
		}
	}
	selectedSkills, err := readSelectedSkillRequests(canonicalRepoRoot, selections)
	if err != nil {
		return SkillsReconcileOutput{}, err
	}
	if err := prepareTargetRoot(targetRoot); err != nil {
		return SkillsReconcileOutput{}, err
	}
	switch targetOwnership {
	case skillsTargetOwnershipAllEntries:
		if err := pruneTargetRoot(targetRoot); err != nil {
			return SkillsReconcileOutput{}, err
		}
	case skillsTargetOwnershipManagedSymlinks:
		if err := pruneManagedTargetSymlinks(targetRoot); err != nil {
			return SkillsReconcileOutput{}, err
		}
	default:
		return SkillsReconcileOutput{}, fmt.Errorf("unknown skills target ownership %s", targetOwnership)
	}

	reconciledSkills := make([]ReconciledSkill, 0, len(selectedSkills))
	for _, selectedSkill := range selectedSkills {
		targetPath := filepath.Join(targetRoot, selectedSkill.Name)
		if err := os.Symlink(selectedSkill.SourcePath, targetPath); err != nil {
			return SkillsReconcileOutput{}, fmt.Errorf("failed to symlink skill %s to %s: %w", targetPath, selectedSkill.SourcePath, err)
		}
		reconciledSkills = append(reconciledSkills, ReconciledSkill{
			Name:         selectedSkill.Name,
			RelativePath: selectedSkill.RelativePath,
			SourcePath:   selectedSkill.SourcePath,
			TargetPath:   targetPath,
		})
	}
	if targetOwnership == skillsTargetOwnershipManagedSymlinks {
		managedSkillNames := make([]string, 0, len(reconciledSkills))
		for _, reconciledSkill := range reconciledSkills {
			managedSkillNames = append(managedSkillNames, reconciledSkill.Name)
		}
		if err := writeManagedSkillsManifest(targetRoot, managedSkillNames); err != nil {
			return SkillsReconcileOutput{}, err
		}
	}

	return SkillsReconcileOutput{
		Runtime:    runtime,
		TargetRoot: targetRoot,
		Skills:     reconciledSkills,
	}, nil
}

type selectedSkill struct {
	Name         string
	RelativePath string
	SourcePath   string
}

type skillsReconcileRequest struct {
	ExpectedName *string
	RelativePath string
}

func readSelectedSkillRequests(repoRoot string, selections []skillsReconcileRequest) ([]selectedSkill, error) {
	selectedSkills := make([]selectedSkill, 0, len(selections))
	selectedPaths := make(map[string]struct{}, len(selections))
	namesToPaths := make(map[string]string, len(selections))
	for _, selection := range selections {
		normalizedRelativePath, err := normalizeSelectedRelativePath(selection.RelativePath)
		if err != nil {
			return nil, err
		}
		if _, ok := selectedPaths[normalizedRelativePath]; ok {
			return nil, fmt.Errorf("selected skill path '%s' was provided more than once", normalizedRelativePath)
		}
		selectedPaths[normalizedRelativePath] = struct{}{}

		sourcePath := filepath.Join(repoRoot, repoRelativePathToPath(normalizedRelativePath))
		canonicalSourcePath, err := filepath.EvalSymlinks(sourcePath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("failed to resolve selected skill path '%s' at %s: %w", normalizedRelativePath, sourcePath, err)
		}
		if !pathIsWithin(canonicalSourcePath, repoRoot) {
			return nil, fmt.Errorf("selected skill path '%s' resolves outside the repo root", normalizedRelativePath)
		}
		sourceStat, err := os.Stat(canonicalSourcePath)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve selected skill path '%s' at %s: %w", normalizedRelativePath, canonicalSourcePath, err)
		}
		if !sourceStat.IsDir() {
			if selection.ExpectedName != nil {
				continue
			}
			return nil, fmt.Errorf("selected skill path '%s' at %s is not a directory", normalizedRelativePath, canonicalSourcePath)
		}

		skillFilePath := filepath.Join(canonicalSourcePath, skillFileName)
		skillFileStat, err := os.Stat(skillFilePath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				if selection.ExpectedName != nil {
					continue
				}
				return nil, fmt.Errorf("selected skill path '%s' at %s is missing SKILL.md", normalizedRelativePath, canonicalSourcePath)
			}
			return nil, fmt.Errorf("failed to read skill file %s: %w", skillFilePath, err)
		}
		if !skillFileStat.Mode().IsRegular() {
			if selection.ExpectedName != nil {
				continue
			}
			return nil, fmt.Errorf("selected skill path '%s' at %s is missing SKILL.md", normalizedRelativePath, canonicalSourcePath)
		}

		skill, err := readSkillFile(repoRoot, skillFilePath)
		if err != nil {
			if selection.ExpectedName != nil && isSelectedSkillMetadataDrift(err) {
				continue
			}
			return nil, err
		}
		if selection.ExpectedName != nil && skill.Name != *selection.ExpectedName {
			continue
		}
		if firstPath, ok := namesToPaths[skill.Name]; ok {
			return nil, fmt.Errorf("selected skills '%s' and '%s' both declare skill name '%s'", firstPath, normalizedRelativePath, skill.Name)
		}
		namesToPaths[skill.Name] = normalizedRelativePath
		selectedSkills = append(selectedSkills, selectedSkill{
			Name:         skill.Name,
			RelativePath: skill.RelativePath,
			SourcePath:   canonicalSourcePath,
		})
	}
	sort.Slice(selectedSkills, func(leftIndex, rightIndex int) bool {
		return selectedSkills[leftIndex].Name < selectedSkills[rightIndex].Name
	})
	return selectedSkills, nil
}

func isSelectedSkillMetadataDrift(err error) bool {
	message := err.Error()
	for _, substring := range []string{
		"must begin with YAML frontmatter",
		"has unterminated YAML frontmatter",
		"has invalid YAML frontmatter",
		"must use a YAML mapping for frontmatter",
		"is missing required frontmatter field",
		"frontmatter field",
		"has invalid skill name",
	} {
		if strings.Contains(message, substring) {
			return true
		}
	}
	return false
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

func validateSkillsRuntime(runtime string) error {
	switch runtime {
	case "codex", "opencode", "pi":
		return nil
	default:
		return fmt.Errorf("unknown skills runtime '%s' (expected 'codex', 'opencode', or 'pi')", runtime)
	}
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

func normalizeSelectedRelativePath(relativePath string) (string, error) {
	if relativePath == "." {
		return ".", nil
	}
	if strings.TrimSpace(relativePath) == "" || filepath.IsAbs(relativePath) {
		return "", fmt.Errorf("selected skill path '%s' must be a repo-relative directory path", relativePath)
	}
	components := []string{}
	for _, component := range strings.Split(filepath.Clean(relativePath), string(filepath.Separator)) {
		if component == "" || component == "." || component == ".." {
			return "", fmt.Errorf("selected skill path '%s' must be a repo-relative directory path", relativePath)
		}
		components = append(components, component)
	}
	if len(components) == 0 {
		return "", fmt.Errorf("selected skill path '%s' must be a repo-relative directory path", relativePath)
	}
	return filepath.ToSlash(filepath.Join(components...)), nil
}

func repoRelativePathToPath(relativePath string) string {
	if relativePath == "." {
		return ""
	}
	return filepath.FromSlash(relativePath)
}

func pathIsWithin(path string, root string) bool {
	relativePath, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relativePath == "." || relativePath != ".." && !strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) && !filepath.IsAbs(relativePath)
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

func pullGitRepo(repoRoot string) error {
	command := exec.Command("git", "-C", repoRoot, "pull", "--ff-only")
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}
	return fmt.Errorf("failed to pull skills repo %s before reconciliation: %s", repoRoot, strings.TrimSpace(string(output)))
}

func prepareTargetRoot(targetRoot string) error {
	if err := rejectSymlinkedExistingTargetPath(targetRoot); err != nil {
		return err
	}
	if err := os.MkdirAll(targetRoot, 0o777); err != nil {
		return fmt.Errorf("failed to create skills target root %s: %w", targetRoot, err)
	}
	return rejectSymlinkedExistingTargetPath(targetRoot)
}

func rejectSymlinkedExistingTargetPath(targetRoot string) error {
	cleanTargetRoot := filepath.Clean(targetRoot)
	currentPath := ""
	if filepath.IsAbs(cleanTargetRoot) {
		currentPath = string(filepath.Separator)
		cleanTargetRoot = strings.TrimPrefix(cleanTargetRoot, string(filepath.Separator))
	}
	for _, component := range strings.Split(cleanTargetRoot, string(filepath.Separator)) {
		if component == "" {
			continue
		}
		currentPath = filepath.Join(currentPath, component)
		metadata, err := os.Lstat(currentPath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return fmt.Errorf("failed to create skills target root %s: %w", currentPath, err)
		}
		if metadata.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("skills target root path %s must not contain symlinks", currentPath)
		}
	}
	return nil
}

func pruneTargetRoot(targetRoot string) error {
	entries, err := os.ReadDir(targetRoot)
	if err != nil {
		return fmt.Errorf("failed to read skills target root %s: %w", targetRoot, err)
	}
	for _, entry := range entries {
		path := filepath.Join(targetRoot, entry.Name())
		var removeErr error
		if entry.IsDir() {
			removeErr = os.RemoveAll(path)
		} else {
			removeErr = os.Remove(path)
		}
		if removeErr != nil {
			return fmt.Errorf("failed to remove stale skills target entry %s: %w", path, removeErr)
		}
	}
	return nil
}

type managedSkillsManifest struct {
	Version    int      `json:"version"`
	SkillNames []string `json:"skillNames"`
}

func pruneManagedTargetSymlinks(targetRoot string) error {
	manifest, ok, err := readManagedSkillsManifest(targetRoot)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	for _, skillName := range manifest.SkillNames {
		if !isValidSkillName(skillName) {
			return fmt.Errorf("managed skills manifest %s contains invalid skill name '%s'", managedSkillsManifestPath(targetRoot), skillName)
		}
		targetPath := filepath.Join(targetRoot, skillName)
		metadata, err := os.Lstat(targetPath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return fmt.Errorf("failed to read skills target root %s: %w", targetPath, err)
		}
		if metadata.Mode()&os.ModeSymlink == 0 {
			return fmt.Errorf("managed skills target entry %s is not a symlink", targetPath)
		}
		if err := os.Remove(targetPath); err != nil {
			return fmt.Errorf("failed to remove stale skills target entry %s: %w", targetPath, err)
		}
	}
	return nil
}

func readManagedSkillsManifest(targetRoot string) (managedSkillsManifest, bool, error) {
	manifestPath := managedSkillsManifestPath(targetRoot)
	content, err := os.ReadFile(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return managedSkillsManifest{}, false, nil
		}
		return managedSkillsManifest{}, false, fmt.Errorf("failed to read managed skills manifest %s: %w", manifestPath, err)
	}
	var manifest managedSkillsManifest
	if err := json.Unmarshal(content, &manifest); err != nil {
		return managedSkillsManifest{}, false, fmt.Errorf("failed to parse managed skills manifest %s: %w", manifestPath, err)
	}
	if manifest.Version != managedSkillsManifestVersion {
		return managedSkillsManifest{}, false, fmt.Errorf("managed skills manifest %s has unsupported version %d", manifestPath, manifest.Version)
	}
	return manifest, true, nil
}

func writeManagedSkillsManifest(targetRoot string, skillNames []string) error {
	manifestPath := managedSkillsManifestPath(targetRoot)
	content, err := json.MarshalIndent(managedSkillsManifest{Version: managedSkillsManifestVersion, SkillNames: skillNames}, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to write managed skills manifest %s: %w", manifestPath, err)
	}
	if err := os.WriteFile(manifestPath, content, 0o666); err != nil {
		return fmt.Errorf("failed to write managed skills manifest %s: %w", manifestPath, err)
	}
	return nil
}

func managedSkillsManifestPath(targetRoot string) string {
	return filepath.Join(targetRoot, managedSkillsManifestFileName)
}
