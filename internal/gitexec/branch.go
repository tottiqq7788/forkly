package gitexec

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"
)

type BranchInfo struct {
	Name      string `json:"name"`
	Current   bool   `json:"current"`
	Short     string `json:"short,omitempty"`
	Subject   string `json:"subject,omitempty"`
	Date      string `json:"date,omitempty"`
	IsUnborn  bool   `json:"isUnborn,omitempty"`
}

type BranchList struct {
	Current  string       `json:"current"`
	Detached bool         `json:"detached"`
	HasHead  bool         `json:"hasHead"`
	Branches []BranchInfo `json:"branches"`
	Dirty    bool         `json:"dirty"`
	FileCount int         `json:"fileCount"`
	Blockers []string     `json:"blockers,omitempty"`
	CanSwitch bool        `json:"canSwitch"`
	CanMutate bool        `json:"canMutate"`
}

type BranchResult struct {
	OK     bool           `json:"ok"`
	Branch string         `json:"branch"`
	Status StatusSnapshot `json:"status"`
}

// assertBranchName rejects values that could be parsed as git CLI options
// or violate local branch refname rules.
func assertBranchName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("分支名不能为空")
	}
	if len(name) > 255 {
		return fmt.Errorf("分支名过长")
	}
	if strings.HasPrefix(name, "-") {
		return fmt.Errorf("分支名无效")
	}
	lower := strings.ToLower(name)
	if lower == "head" || lower == "fetch_head" || lower == "orig_head" || lower == "merge_head" {
		return fmt.Errorf("分支名无效")
	}
	if strings.HasPrefix(lower, "refs/") {
		return fmt.Errorf("分支名无效")
	}
	if strings.Contains(name, "..") || strings.Contains(name, "@{") || strings.Contains(name, "\\") {
		return fmt.Errorf("分支名无效")
	}
	if strings.HasPrefix(name, "/") || strings.HasSuffix(name, "/") || strings.Contains(name, "//") {
		return fmt.Errorf("分支名无效")
	}
	if strings.HasSuffix(name, ".") || strings.HasSuffix(name, ".lock") {
		return fmt.Errorf("分支名无效")
	}
	for _, r := range name {
		switch r {
		case ' ', '\t', '\n', '\r', '~', '^', ':', '?', '*', '[', '\\', '\x7f':
			return fmt.Errorf("分支名无效")
		}
		if r < 0x20 {
			return fmt.Errorf("分支名无效")
		}
		if unicode.IsControl(r) {
			return fmt.Errorf("分支名无效")
		}
	}
	// Reject SHA-like names that would be ambiguous with object IDs.
	if objectIDRe.MatchString(name) {
		return fmt.Errorf("分支名不能是提交哈希")
	}
	return nil
}

func (e *Executor) ListBranches(ctx context.Context, repo string) (BranchList, error) {
	st, err := e.Status(ctx, repo)
	if err != nil {
		return BranchList{}, err
	}
	out := BranchList{
		Current:   st.Health.Branch,
		Detached:  st.Health.Detached,
		HasHead:   st.Health.HasHead,
		Dirty:     len(st.Files) > 0,
		FileCount: len(st.Files),
		Blockers:  append([]string{}, st.Health.Blockers...),
	}
	out.CanMutate = canMutateBranches(st.Health)
	out.CanSwitch = out.CanMutate && !out.Dirty

	res, err := e.Run(ctx, RunOpts{
		Repo: repo,
		Args: []string{
			"for-each-ref",
			"--sort=-committerdate",
			"--format=%(refname:short)%00%(objectname:short)%00%(subject)%00%(committerdate:iso-strict)%00%(HEAD)",
			"refs/heads/",
		},
		Timeout: 15 * time.Second,
	})
	if err != nil {
		return out, err
	}
	branches := parseBranchRefs(res.Stdout)
	if !st.Health.HasHead && !st.Health.Detached {
		// Unborn branch (fresh init): ensure current name appears.
		current := st.Health.Branch
		if current == "" {
			current = "main"
		}
		found := false
		for _, b := range branches {
			if b.Name == current {
				found = true
				break
			}
		}
		if !found {
			branches = append([]BranchInfo{{
				Name:     current,
				Current:  true,
				IsUnborn: true,
			}}, branches...)
		}
		out.Current = current
	}
	if st.Health.Detached {
		for i := range branches {
			branches[i].Current = false
		}
	}
	out.Branches = branches
	return out, nil
}

func parseBranchRefs(data []byte) []BranchInfo {
	parts := strings.Split(string(data), "\n")
	out := make([]BranchInfo, 0, len(parts))
	for _, line := range parts {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\x00")
		if len(fields) < 1 || fields[0] == "" {
			continue
		}
		b := BranchInfo{Name: fields[0]}
		if len(fields) > 1 {
			b.Short = fields[1]
		}
		if len(fields) > 2 {
			b.Subject = fields[2]
		}
		if len(fields) > 3 {
			b.Date = fields[3]
		}
		if len(fields) > 4 && strings.TrimSpace(fields[4]) == "*" {
			b.Current = true
		}
		out = append(out, b)
	}
	return out
}

func canMutateBranches(h RepoHealth) bool {
	if h.Bare {
		return false
	}
	if h.MergeInProgress || h.RebaseInProgress || h.CherryPick || h.Revert || h.IndexLocked {
		return false
	}
	for _, b := range h.Blockers {
		if strings.Contains(b, "不是有效的 Git 工作区") {
			return false
		}
	}
	return true
}

func (e *Executor) ensureSwitchable(ctx context.Context, repo string) (StatusSnapshot, error) {
	st, err := e.Status(ctx, repo)
	if err != nil {
		return StatusSnapshot{}, err
	}
	if !canMutateBranches(st.Health) {
		if len(st.Health.Blockers) > 0 {
			return st, fmt.Errorf("%s", st.Health.Blockers[0])
		}
		return st, fmt.Errorf("当前仓库状态不允许切换分支")
	}
	if len(st.Files) > 0 {
		return st, fmt.Errorf("工作区有未保存的修改，请先保存版本或处理后再切换分支")
	}
	return st, nil
}

func (e *Executor) localBranchExists(ctx context.Context, repo, name string) (bool, error) {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"show-ref", "--verify", "--quiet", "refs/heads/" + name},
		Timeout: 5 * time.Second,
	})
	if err == nil {
		return true, nil
	}
	// show-ref returns exit 1 when missing
	if res.ExitCode == 1 {
		return false, nil
	}
	return false, err
}

func (e *Executor) SwitchBranch(ctx context.Context, repo, name string) (BranchResult, error) {
	if err := assertBranchName(name); err != nil {
		return BranchResult{}, err
	}
	if _, err := e.ensureSwitchable(ctx, repo); err != nil {
		return BranchResult{}, err
	}
	exists, err := e.localBranchExists(ctx, repo, name)
	if err != nil {
		return BranchResult{}, err
	}
	if !exists {
		return BranchResult{}, fmt.Errorf("本地分支不存在：%s", name)
	}
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"switch", "--", name},
		Write:   true,
		Timeout: 30 * time.Second,
	})
	if err != nil {
		msg := strings.TrimSpace(string(res.Stderr))
		if msg == "" {
			msg = err.Error()
		}
		return BranchResult{}, fmt.Errorf("%s", msg)
	}
	st, err := e.Status(ctx, repo)
	if err != nil {
		return BranchResult{}, err
	}
	return BranchResult{OK: true, Branch: st.Health.Branch, Status: st}, nil
}

func (e *Executor) CreateAndSwitchBranch(ctx context.Context, repo, name string) (BranchResult, error) {
	if err := assertBranchName(name); err != nil {
		return BranchResult{}, err
	}
	if _, err := e.ensureSwitchable(ctx, repo); err != nil {
		return BranchResult{}, err
	}
	exists, err := e.localBranchExists(ctx, repo, name)
	if err != nil {
		return BranchResult{}, err
	}
	if exists {
		return BranchResult{}, fmt.Errorf("分支已存在：%s", name)
	}
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"switch", "-c", name},
		Write:   true,
		Timeout: 30 * time.Second,
	})
	if err != nil {
		msg := strings.TrimSpace(string(res.Stderr))
		if msg == "" {
			msg = err.Error()
		}
		return BranchResult{}, fmt.Errorf("%s", msg)
	}
	st, err := e.Status(ctx, repo)
	if err != nil {
		return BranchResult{}, err
	}
	return BranchResult{OK: true, Branch: st.Health.Branch, Status: st}, nil
}

func (e *Executor) RenameBranch(ctx context.Context, repo, oldName, newName string) (BranchResult, error) {
	if err := assertBranchName(oldName); err != nil {
		return BranchResult{}, err
	}
	if err := assertBranchName(newName); err != nil {
		return BranchResult{}, err
	}
	st, err := e.Status(ctx, repo)
	if err != nil {
		return BranchResult{}, err
	}
	if !canMutateBranches(st.Health) {
		if len(st.Health.Blockers) > 0 {
			return BranchResult{}, fmt.Errorf("%s", st.Health.Blockers[0])
		}
		return BranchResult{}, fmt.Errorf("当前仓库状态不允许重命名分支")
	}
	exists, err := e.localBranchExists(ctx, repo, oldName)
	if err != nil {
		return BranchResult{}, err
	}
	if !exists {
		return BranchResult{}, fmt.Errorf("本地分支不存在：%s", oldName)
	}
	newExists, err := e.localBranchExists(ctx, repo, newName)
	if err != nil {
		return BranchResult{}, err
	}
	if newExists {
		return BranchResult{}, fmt.Errorf("分支已存在：%s", newName)
	}
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"branch", "-m", oldName, newName},
		Write:   true,
		Timeout: 15 * time.Second,
	})
	if err != nil {
		msg := strings.TrimSpace(string(res.Stderr))
		if msg == "" {
			msg = err.Error()
		}
		return BranchResult{}, fmt.Errorf("%s", msg)
	}
	st, err = e.Status(ctx, repo)
	if err != nil {
		return BranchResult{}, err
	}
	branch := newName
	if !st.Health.Detached && st.Health.Branch != "" {
		branch = st.Health.Branch
	}
	return BranchResult{OK: true, Branch: branch, Status: st}, nil
}

func (e *Executor) DeleteBranch(ctx context.Context, repo, name string) (BranchResult, error) {
	if err := assertBranchName(name); err != nil {
		return BranchResult{}, err
	}
	st, err := e.Status(ctx, repo)
	if err != nil {
		return BranchResult{}, err
	}
	if !canMutateBranches(st.Health) {
		if len(st.Health.Blockers) > 0 {
			return BranchResult{}, fmt.Errorf("%s", st.Health.Blockers[0])
		}
		return BranchResult{}, fmt.Errorf("当前仓库状态不允许删除分支")
	}
	if !st.Health.Detached && st.Health.Branch == name {
		return BranchResult{}, fmt.Errorf("不能删除当前分支")
	}
	exists, err := e.localBranchExists(ctx, repo, name)
	if err != nil {
		return BranchResult{}, err
	}
	if !exists {
		return BranchResult{}, fmt.Errorf("本地分支不存在：%s", name)
	}
	// Safe delete only (-d), never -D.
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"branch", "-d", name},
		Write:   true,
		Timeout: 15 * time.Second,
	})
	if err != nil {
		msg := strings.TrimSpace(string(res.Stderr))
		if msg == "" {
			msg = err.Error()
		}
		return BranchResult{}, fmt.Errorf("%s", msg)
	}
	st, err = e.Status(ctx, repo)
	if err != nil {
		return BranchResult{}, err
	}
	return BranchResult{OK: true, Branch: st.Health.Branch, Status: st}, nil
}
