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

func TestRunDispatchesSkillsReconcileCommand(t *testing.T) {
	repoRoot, _ := createSkillsGitRepoWithOrigin(t)
	targetRoot := createRealSkillsTempDir(t, "target")
	writeSkill(t, repoRoot, ".agents/skills/write-a-skill", `---
name: write-a-skill
description: Write a new skill.
---
`)
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	code := Run(
		"sandboxd",
		[]string{
			"skills",
			"reconcile",
			"--repo",
			repoRoot,
			"--runtime",
			"pi",
			"--skill",
			".agents/skills/write-a-skill",
			"--target-root",
			targetRoot,
		},
		strings.NewReader(""),
		&stdout,
		&stderr,
	)

	assertEqual(t, code, 0)
	assertEqual(t, stderr.String(), "")
	var output SkillsReconcileOutput
	requireNoError(t, json.Unmarshal(stdout.Bytes(), &output))
	assertEqual(t, output.Runtime, "pi")
	assertEqual(t, output.TargetRoot, targetRoot)
	if len(output.Skills) != 1 {
		t.Fatalf("expected 1 reconciled skill, got %d", len(output.Skills))
	}
	assertEqual(t, output.Skills[0].Name, "write-a-skill")
	assertEqual(t, output.Skills[0].RelativePath, ".agents/skills/write-a-skill")
	assertEqual(t, output.Skills[0].SourcePath, filepath.Join(repoRoot, ".agents/skills/write-a-skill"))
	assertEqual(t, output.Skills[0].TargetPath, filepath.Join(targetRoot, "write-a-skill"))
	target, err := os.Readlink(filepath.Join(targetRoot, "write-a-skill"))
	requireNoError(t, err)
	assertEqual(t, target, filepath.Join(repoRoot, ".agents/skills/write-a-skill"))
	assertEqual(t, strings.HasSuffix(stdout.String(), "\n"), true)
}

func TestReconcileSkillsPrunesStaleTargetEntries(t *testing.T) {
	repoRoot, _ := createSkillsGitRepoWithOrigin(t)
	targetRoot := createRealSkillsTempDir(t, "target")
	writeSkill(t, repoRoot, ".", `---
name: root-skill
description: Skill defined at the repository root.
---
`)
	requireNoError(t, os.MkdirAll(filepath.Join(targetRoot, "stale-directory"), 0o777))
	requireNoError(t, os.WriteFile(filepath.Join(targetRoot, "stale-directory", "old.txt"), []byte("old"), 0o666))
	requireNoError(t, os.WriteFile(filepath.Join(targetRoot, "stale-file"), []byte("old"), 0o666))

	output, err := ReconcileSkills(repoRoot, "opencode", []string{"."}, targetRoot)

	requireNoError(t, err)
	assertEqual(t, output.Runtime, "opencode")
	assertEqual(t, len(output.Skills), 1)
	target, err := os.Readlink(filepath.Join(targetRoot, "root-skill"))
	requireNoError(t, err)
	assertEqual(t, target, repoRoot)
	if _, err := os.Stat(filepath.Join(targetRoot, "stale-directory")); !os.IsNotExist(err) {
		t.Fatalf("expected stale directory to be pruned, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(targetRoot, "stale-file")); !os.IsNotExist(err) {
		t.Fatalf("expected stale file to be pruned, got %v", err)
	}
}

func TestReconcileSkillsPullsRepoBeforeLinkingSelectedSkills(t *testing.T) {
	repoRoot, remoteRoot := createSkillsGitRepoWithOrigin(t)
	updaterRoot := filepath.Join(createRealSkillsTempDir(t, "updater-parent"), "updater")
	targetRoot := createRealSkillsTempDir(t, "target")
	writeSkill(t, repoRoot, "skills/old-skill", `---
name: old-skill
description: Old skill.
---
`)
	commitSkillsRepo(t, repoRoot)
	runGit(t, repoRoot, "push")
	requireNoError(t, os.WriteFile(filepath.Join(targetRoot, "old-skill"), []byte("stale"), 0o666))
	cloneSkillsRepo(t, remoteRoot, updaterRoot)
	runGit(t, updaterRoot, "config", "user.name", "Mistle Tests")
	runGit(t, updaterRoot, "config", "user.email", "mistle-tests@example.com")
	requireNoError(t, os.RemoveAll(filepath.Join(updaterRoot, "skills", "old-skill")))
	writeSkill(t, updaterRoot, "skills/new-skill", `---
name: new-skill
description: New skill.
---
`)
	commitSkillsRepo(t, updaterRoot)
	runGit(t, updaterRoot, "push")

	output, err := ReconcileSkills(repoRoot, "codex", []string{"skills/old-skill", "skills/new-skill"}, targetRoot)

	requireNoError(t, err)
	if len(output.Skills) != 1 {
		t.Fatalf("expected 1 reconciled skill, got %d", len(output.Skills))
	}
	assertEqual(t, output.Skills[0].Name, "new-skill")
	if _, err := os.Stat(filepath.Join(targetRoot, "old-skill")); !os.IsNotExist(err) {
		t.Fatalf("expected stale removed skill target to be pruned, got %v", err)
	}
	target, err := os.Readlink(filepath.Join(targetRoot, "new-skill"))
	requireNoError(t, err)
	assertEqual(t, target, filepath.Join(repoRoot, "skills/new-skill"))
}

func TestReconcileSkillsRejectsSelectedPathsThatEscapeRepo(t *testing.T) {
	repoRoot, _ := createSkillsGitRepoWithOrigin(t)

	_, err := ReconcileSkills(repoRoot, "codex", []string{"../outside"}, createRealSkillsTempDir(t, "target"))

	assertError(t, err, "selected skill path '../outside' must be a repo-relative directory path")
}

func TestReconcileSkillsRejectsDuplicateSelectedSkillNames(t *testing.T) {
	repoRoot, _ := createSkillsGitRepoWithOrigin(t)
	writeSkill(t, repoRoot, "one", `---
name: duplicate-skill
description: First.
---
`)
	writeSkill(t, repoRoot, "two", `---
name: duplicate-skill
description: Second.
---
`)

	_, err := ReconcileSkills(repoRoot, "codex", []string{"one", "two"}, createRealSkillsTempDir(t, "target"))

	assertError(t, err, "selected skills 'one' and 'two' both declare skill name 'duplicate-skill'")
}

func TestReconcileSkillsRejectsSymlinkedTargetRootWithoutPruningDestination(t *testing.T) {
	repoRoot, _ := createSkillsGitRepoWithOrigin(t)
	destination := createRealSkillsTempDir(t, "destination")
	targetRoot := filepath.Join(createRealSkillsTempDir(t, "target-parent"), "linked-target")
	requireNoError(t, os.WriteFile(filepath.Join(destination, "stale-skill"), []byte("old"), 0o666))
	requireNoError(t, os.Symlink(destination, targetRoot))

	_, err := ReconcileSkills(repoRoot, "pi", nil, targetRoot)

	assertError(t, err, "skills target root path "+targetRoot+" must not contain symlinks")
	contents, readErr := os.ReadFile(filepath.Join(destination, "stale-skill"))
	requireNoError(t, readErr)
	assertEqual(t, string(contents), "old")
}

func createSkillsGitRepo(t *testing.T) string {
	t.Helper()
	repoRoot := createRealSkillsTempDir(t, "repo")
	runGit(t, repoRoot, "init")
	runGit(t, repoRoot, "config", "user.name", "Mistle Tests")
	runGit(t, repoRoot, "config", "user.email", "mistle-tests@example.com")
	return repoRoot
}

func createSkillsGitRepoWithOrigin(t *testing.T) (string, string) {
	t.Helper()
	repoRoot := createSkillsGitRepo(t)
	remoteRoot := filepath.Join(createRealSkillsTempDir(t, "remote-parent"), "remote.git")
	runGitCommand(t, "", "init", "--bare", remoteRoot)
	requireNoError(t, os.WriteFile(filepath.Join(repoRoot, ".gitkeep"), []byte(""), 0o666))
	commitSkillsRepo(t, repoRoot)
	runGit(t, repoRoot, "remote", "add", "origin", remoteRoot)
	runGit(t, repoRoot, "push", "-u", "origin", "HEAD")
	return repoRoot, remoteRoot
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
	runGitCommand(t, repoRoot, args...)
}

func runGitCommand(t *testing.T, repoRoot string, args ...string) {
	t.Helper()
	commandArgs := []string{"-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"}
	if repoRoot != "" {
		commandArgs = append(commandArgs, "-C", repoRoot)
	}
	commandArgs = append(commandArgs, args...)
	command := exec.Command("git", commandArgs...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(output))
	}
}

func runGitOutput(t *testing.T, repoRoot string, args ...string) string {
	t.Helper()
	commandArgs := []string{"-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-C", repoRoot}
	commandArgs = append(commandArgs, args...)
	command := exec.Command("git", commandArgs...)
	output, err := command.Output()
	if err != nil {
		t.Fatalf("git %s failed: %v", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(string(output))
}

func cloneSkillsRepo(t *testing.T, remoteRoot string, cloneRoot string) {
	t.Helper()
	runGitCommand(t, "", "clone", remoteRoot, cloneRoot)
}

func createRealSkillsTempDir(t *testing.T, prefix string) string {
	t.Helper()
	tempRoot, err := filepath.EvalSymlinks(os.TempDir())
	requireNoError(t, err)
	dir, err := os.MkdirTemp(tempRoot, "sbd-skills-"+prefix+"-*")
	requireNoError(t, err)
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
	return dir
}
