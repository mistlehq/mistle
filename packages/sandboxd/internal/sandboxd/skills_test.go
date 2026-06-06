package sandboxd

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiscoverSkillsReadsFrontmatterFromCommittedGitRepo(t *testing.T) {
	repoRoot := createSkillsGitRepo(t)
	writeSkill(t, repoRoot, ".agents/skills/github-pr-authoring", `---
name: github-pr-authoring
description: Draft or update GitHub pull requests.
---

Skill body.
`)
	writeSkill(t, repoRoot, "nested/custom-skill", `---
description: |-
  Custom skill with
  a multiline description.
metadata:
  runtimes:
    - codex
name: custom-skill
---
`)
	commitSkillsRepo(t, repoRoot)
	expectedCommitSHA := runGitOutput(t, repoRoot, "rev-parse", "HEAD")

	output, err := DiscoverSkills(repoRoot)

	requireNoError(t, err)
	assertEqual(t, output.CommitSHA, expectedCommitSHA)
	if len(output.Skills) != 2 {
		t.Fatalf("expected 2 discovered skills, got %d", len(output.Skills))
	}
	assertEqual(t, output.Skills[0].Name, "custom-skill")
	assertEqual(t, output.Skills[0].Description, "Custom skill with\na multiline description.")
	assertEqual(t, output.Skills[0].RelativePath, "nested/custom-skill")
	assertEqual(t, output.Skills[1].Name, "github-pr-authoring")
	assertEqual(t, output.Skills[1].Description, "Draft or update GitHub pull requests.")
	assertEqual(t, output.Skills[1].RelativePath, ".agents/skills/github-pr-authoring")
}

func TestDiscoverSkillsReportsRootSkillWithDotRelativePath(t *testing.T) {
	repoRoot := createSkillsGitRepo(t)
	writeSkill(t, repoRoot, ".", `---
name: root-skill
description: Skill defined at the repository root.
---
`)
	commitSkillsRepo(t, repoRoot)

	output, err := DiscoverSkills(repoRoot)

	requireNoError(t, err)
	if len(output.Skills) != 1 {
		t.Fatalf("expected 1 discovered skill, got %d", len(output.Skills))
	}
	assertEqual(t, output.Skills[0].Name, "root-skill")
	assertEqual(t, output.Skills[0].RelativePath, ".")
}

func TestRunDispatchesSkillsDiscoverCommand(t *testing.T) {
	repoRoot := createSkillsGitRepo(t)
	writeSkill(t, repoRoot, ".agents/skills/write-a-skill", `---
name: write-a-skill
description: Write a new skill.
---
`)
	commitSkillsRepo(t, repoRoot)
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	code := Run(
		"sandboxd",
		[]string{"skills", "discover", "--repo", repoRoot},
		strings.NewReader(""),
		&stdout,
		&stderr,
	)

	assertEqual(t, code, 0)
	assertEqual(t, stderr.String(), "")
	var output SkillsDiscoverOutput
	requireNoError(t, json.Unmarshal(stdout.Bytes(), &output))
	if len(output.Skills) != 1 {
		t.Fatalf("expected 1 discovered skill, got %d", len(output.Skills))
	}
	assertEqual(t, output.Skills[0].Name, "write-a-skill")
	assertEqual(t, output.Skills[0].Description, "Write a new skill.")
	assertEqual(t, output.Skills[0].RelativePath, ".agents/skills/write-a-skill")
	assertEqual(t, strings.HasSuffix(stdout.String(), "\n"), true)
}

func TestDiscoverSkillsRejectsDuplicateSkillNames(t *testing.T) {
	repoRoot := createSkillsGitRepo(t)
	writeSkill(t, repoRoot, "first", `---
name: duplicate-skill
description: First skill.
---
`)
	writeSkill(t, repoRoot, "second", `---
name: duplicate-skill
description: Second skill.
---
`)
	commitSkillsRepo(t, repoRoot)

	_, err := DiscoverSkills(repoRoot)

	assertError(t, err, "duplicate skill name 'duplicate-skill' discovered at 'first' and 'second'")
}

func TestDiscoverSkillsRejectsInvalidFrontmatter(t *testing.T) {
	repoRoot := createSkillsGitRepo(t)
	writeSkill(t, repoRoot, "bad-skill", "name: bad-skill\n")
	commitSkillsRepo(t, repoRoot)

	_, err := DiscoverSkills(repoRoot)

	if err == nil {
		t.Fatalf("expected missing frontmatter to fail")
	}
	if !strings.Contains(err.Error(), "must begin with YAML frontmatter") {
		t.Fatalf("expected missing frontmatter error, got %q", err.Error())
	}
}

func TestRunSkillsReconcileReportsExplicitUnportedError(t *testing.T) {
	var stdout bytes.Buffer

	err := RunSkills([]string{"reconcile", "--repo", "/repo", "--runtime", "codex"}, &stdout)

	assertError(t, err, "sandboxd skills reconcile is not ported to Go yet")
	assertEqual(t, stdout.String(), "")
}

func createSkillsGitRepo(t *testing.T) string {
	t.Helper()
	repoRoot := t.TempDir()
	runGit(t, repoRoot, "init")
	runGit(t, repoRoot, "config", "user.name", "Mistle Tests")
	runGit(t, repoRoot, "config", "user.email", "mistle-tests@example.com")
	return repoRoot
}

func writeSkill(t *testing.T, repoRoot string, relativeDirectory string, content string) {
	t.Helper()
	skillDirectory := filepath.Join(repoRoot, filepath.FromSlash(relativeDirectory))
	requireNoError(t, os.MkdirAll(skillDirectory, 0o777))
	requireNoError(t, os.WriteFile(filepath.Join(skillDirectory, skillFileName), []byte(content), 0o666))
}

func commitSkillsRepo(t *testing.T, repoRoot string) {
	t.Helper()
	runGit(t, repoRoot, "add", ".")
	runGit(t, repoRoot, "commit", "-m", "add skills")
}

func runGit(t *testing.T, repoRoot string, args ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", repoRoot}, args...)...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(output))
	}
}

func runGitOutput(t *testing.T, repoRoot string, args ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", repoRoot}, args...)...)
	output, err := command.Output()
	if err != nil {
		t.Fatalf("git %s failed: %v", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(string(output))
}
