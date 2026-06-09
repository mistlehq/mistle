package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"go.yaml.in/yaml/v4"
)

const runtimeSkillsTargetRoot = "/root/.agents/skills"
const runtimeSkillsManifestFileName = ".mistle-managed-skills.json"
const runtimeSkillsManifestVersion = 1
const runtimeSkillFileName = "SKILL.md"

func ReconcileRuntimePlanSkills(repoRoot string, runtimeID string, selections []CompiledSkillSelection) error {
	if err := validateRuntimePlanSkillsRuntime(runtimeID); err != nil {
		return err
	}
	canonicalRepoRoot, err := canonicalizeRuntimeSkillsRepoRoot(repoRoot)
	if err != nil {
		return err
	}
	selectedSkills, err := readRuntimePlanSelectedSkills(canonicalRepoRoot, selections)
	if err != nil {
		return err
	}
	if err := prepareRuntimeSkillsTargetRoot(runtimeSkillsTargetRoot); err != nil {
		return err
	}
	if err := pruneRuntimeManagedSkillSymlinks(runtimeSkillsTargetRoot); err != nil {
		return err
	}
	for _, selectedSkill := range selectedSkills {
		if err := os.Symlink(selectedSkill.sourcePath, filepath.Join(runtimeSkillsTargetRoot, selectedSkill.name)); err != nil {
			return fmt.Errorf("failed to symlink skill %s to %s: %w", filepath.Join(runtimeSkillsTargetRoot, selectedSkill.name), selectedSkill.sourcePath, err)
		}
	}
	managedSkillNames := make([]string, 0, len(selectedSkills))
	for _, selectedSkill := range selectedSkills {
		managedSkillNames = append(managedSkillNames, selectedSkill.name)
	}
	return writeRuntimeManagedSkillsManifest(runtimeSkillsTargetRoot, managedSkillNames)
}

type runtimePlanSelectedSkill struct {
	name       string
	sourcePath string
}

func readRuntimePlanSelectedSkills(repoRoot string, selections []CompiledSkillSelection) ([]runtimePlanSelectedSkill, error) {
	selectedSkills := make([]runtimePlanSelectedSkill, 0, len(selections))
	selectedPaths := make(map[string]struct{}, len(selections))
	namesToPaths := make(map[string]string, len(selections))
	for _, selection := range selections {
		relativePath, err := normalizeRuntimeSkillRelativePath(selection.RelativePath)
		if err != nil {
			return nil, err
		}
		if _, ok := selectedPaths[relativePath]; ok {
			return nil, fmt.Errorf("selected skill path '%s' was provided more than once", relativePath)
		}
		selectedPaths[relativePath] = struct{}{}

		sourcePath := filepath.Join(repoRoot, runtimeSkillRelativePathToPath(relativePath))
		canonicalSourcePath, err := filepath.EvalSymlinks(sourcePath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("failed to resolve selected skill path '%s' at %s: %w", relativePath, sourcePath, err)
		}
		if !runtimeSkillPathIsWithin(canonicalSourcePath, repoRoot) {
			return nil, fmt.Errorf("selected skill path '%s' resolves outside the repo root", relativePath)
		}
		sourceStat, err := os.Stat(canonicalSourcePath)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve selected skill path '%s' at %s: %w", relativePath, canonicalSourcePath, err)
		}
		if !sourceStat.IsDir() {
			continue
		}

		skillName, ok, err := readRuntimeSkillName(filepath.Join(canonicalSourcePath, runtimeSkillFileName))
		if err != nil {
			return nil, err
		}
		if !ok || skillName != selection.Name {
			continue
		}
		if firstPath, ok := namesToPaths[skillName]; ok {
			return nil, fmt.Errorf("selected skills '%s' and '%s' both declare skill name '%s'", firstPath, relativePath, skillName)
		}
		namesToPaths[skillName] = relativePath
		selectedSkills = append(selectedSkills, runtimePlanSelectedSkill{
			name:       skillName,
			sourcePath: canonicalSourcePath,
		})
	}
	sort.Slice(selectedSkills, func(leftIndex, rightIndex int) bool {
		return selectedSkills[leftIndex].name < selectedSkills[rightIndex].name
	})
	return selectedSkills, nil
}

func readRuntimeSkillName(skillFilePath string) (string, bool, error) {
	content, err := os.ReadFile(skillFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("failed to read skill file %s: %w", skillFilePath, err)
	}
	frontmatter, ok, err := parseRuntimeSkillFrontmatter(skillFilePath, string(content))
	if err != nil {
		return "", false, nil
	}
	if !ok {
		return "", false, nil
	}
	value, ok := frontmatter["name"]
	if !ok {
		return "", false, nil
	}
	name, ok := value.(string)
	if !ok {
		return "", false, nil
	}
	name = strings.TrimSpace(name)
	if !isValidRuntimeSkillName(name) {
		return "", false, nil
	}
	return name, true, nil
}

func parseRuntimeSkillFrontmatter(skillFilePath string, content string) (map[string]any, bool, error) {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSuffix(lines[0], "\r") != "---" {
		return nil, false, nil
	}
	var frontmatter strings.Builder
	for _, rawLine := range lines[1:] {
		line := strings.TrimSuffix(rawLine, "\r")
		if line == "---" {
			fields := map[string]any{}
			if err := yaml.Unmarshal([]byte(frontmatter.String()), &fields); err != nil {
				return nil, false, nil
			}
			if len(fields) == 0 {
				return nil, false, nil
			}
			return fields, true, nil
		}
		frontmatter.WriteString(line)
		frontmatter.WriteByte('\n')
	}
	return nil, false, nil
}

func canonicalizeRuntimeSkillsRepoRoot(repoRoot string) (string, error) {
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

func validateRuntimePlanSkillsRuntime(runtimeID string) error {
	switch runtimeID {
	case "codex", "opencode", "pi":
		return nil
	default:
		return fmt.Errorf("unknown skills runtime '%s' (expected 'codex', 'opencode', or 'pi')", runtimeID)
	}
}

func normalizeRuntimeSkillRelativePath(relativePath string) (string, error) {
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

func runtimeSkillRelativePathToPath(relativePath string) string {
	if relativePath == "." {
		return ""
	}
	return filepath.FromSlash(relativePath)
}

func runtimeSkillPathIsWithin(path string, root string) bool {
	relativePath, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relativePath == "." || relativePath != ".." && !strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) && !filepath.IsAbs(relativePath)
}

func prepareRuntimeSkillsTargetRoot(targetRoot string) error {
	if err := rejectSymlinkedRuntimeSkillsTargetPath(targetRoot); err != nil {
		return err
	}
	if err := os.MkdirAll(targetRoot, 0o777); err != nil {
		return fmt.Errorf("failed to create skills target root %s: %w", targetRoot, err)
	}
	return rejectSymlinkedRuntimeSkillsTargetPath(targetRoot)
}

func rejectSymlinkedRuntimeSkillsTargetPath(targetRoot string) error {
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

type runtimeManagedSkillsManifest struct {
	Version    int      `json:"version"`
	SkillNames []string `json:"skillNames"`
}

func pruneRuntimeManagedSkillSymlinks(targetRoot string) error {
	manifest, ok, err := readRuntimeManagedSkillsManifest(targetRoot)
	if err != nil || !ok {
		return err
	}
	for _, skillName := range manifest.SkillNames {
		if !isValidRuntimeSkillName(skillName) {
			return fmt.Errorf("managed skills manifest %s contains invalid skill name '%s'", runtimeManagedSkillsManifestPath(targetRoot), skillName)
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

func readRuntimeManagedSkillsManifest(targetRoot string) (runtimeManagedSkillsManifest, bool, error) {
	manifestPath := runtimeManagedSkillsManifestPath(targetRoot)
	content, err := os.ReadFile(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return runtimeManagedSkillsManifest{}, false, nil
		}
		return runtimeManagedSkillsManifest{}, false, fmt.Errorf("failed to read managed skills manifest %s: %w", manifestPath, err)
	}
	var manifest runtimeManagedSkillsManifest
	if err := json.Unmarshal(content, &manifest); err != nil {
		return runtimeManagedSkillsManifest{}, false, fmt.Errorf("failed to parse managed skills manifest %s: %w", manifestPath, err)
	}
	if manifest.Version != runtimeSkillsManifestVersion {
		return runtimeManagedSkillsManifest{}, false, fmt.Errorf("managed skills manifest %s has unsupported version %d", manifestPath, manifest.Version)
	}
	return manifest, true, nil
}

func writeRuntimeManagedSkillsManifest(targetRoot string, skillNames []string) error {
	content, err := json.MarshalIndent(runtimeManagedSkillsManifest{Version: runtimeSkillsManifestVersion, SkillNames: skillNames}, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to write managed skills manifest %s: %w", runtimeManagedSkillsManifestPath(targetRoot), err)
	}
	if err := os.WriteFile(runtimeManagedSkillsManifestPath(targetRoot), content, 0o666); err != nil {
		return fmt.Errorf("failed to write managed skills manifest %s: %w", runtimeManagedSkillsManifestPath(targetRoot), err)
	}
	return nil
}

func runtimeManagedSkillsManifestPath(targetRoot string) string {
	return filepath.Join(targetRoot, runtimeSkillsManifestFileName)
}

func isValidRuntimeSkillName(name string) bool {
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
