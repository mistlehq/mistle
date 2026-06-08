package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadRuntimePlanSelectedSkillsSkipsMaterializedSelectionDrift(t *testing.T) {
	repoRoot := t.TempDir()
	writeRuntimeSkillTestFile(t, repoRoot, "skills/new-skill", `---
name: new-skill
description: New skill.
---
`)
	writeRuntimeSkillTestFile(t, repoRoot, "skills/renamed-skill", `---
name: renamed-skill
description: Renamed skill.
---
`)
	requireNoError(t, os.MkdirAll(filepath.Join(repoRoot, "skills", "invalid-skill"), 0o777))
	requireNoError(t, os.WriteFile(filepath.Join(repoRoot, "skills", "invalid-skill", runtimeSkillFileName), []byte("name: invalid\n"), 0o666))
	canonicalRepoRoot, err := canonicalizeRuntimeSkillsRepoRoot(repoRoot)
	requireNoError(t, err)

	selectedSkills, err := readRuntimePlanSelectedSkills(canonicalRepoRoot, []CompiledSkillSelection{
		{Name: "deleted-skill", RelativePath: "skills/deleted-skill"},
		{Name: "old-name", RelativePath: "skills/renamed-skill"},
		{Name: "invalid-skill", RelativePath: "skills/invalid-skill"},
		{Name: "new-skill", RelativePath: "skills/new-skill"},
	})

	requireNoError(t, err)
	if len(selectedSkills) != 1 {
		t.Fatalf("expected 1 selected skill, got %d", len(selectedSkills))
	}
	assertEqual(t, selectedSkills[0].name, "new-skill")
	assertEqual(t, selectedSkills[0].sourcePath, filepath.Join(canonicalRepoRoot, "skills/new-skill"))
}

func writeRuntimeSkillTestFile(t *testing.T, repoRoot string, relativeDirectory string, content string) {
	t.Helper()
	skillDirectory := filepath.Join(repoRoot, filepath.FromSlash(relativeDirectory))
	requireNoError(t, os.MkdirAll(skillDirectory, 0o777))
	requireNoError(t, os.WriteFile(filepath.Join(skillDirectory, runtimeSkillFileName), []byte(content), 0o666))
}
