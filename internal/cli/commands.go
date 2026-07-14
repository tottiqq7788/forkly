package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/agentauth"
	"github.com/forkly-app/forkly/internal/cliinstall"
	"github.com/forkly-app/forkly/internal/runtimeinfo"
)

var Version = "0.1.48"

type Options struct {
	JSON bool
	Yes  bool
}

func Run(args []string, opts Options) int {
	if len(args) == 0 {
		printHelp(os.Stdout)
		return ExitOK
	}
	c, err := NewClient(opts.JSON)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return ExitUnavailable
	}
	c.AppVersion = Version

	cmd := args[0]
	rest := args[1:]
	switch cmd {
	case "help", "-h", "--help":
		printHelp(c.Out)
		return ExitOK
	case "version":
		return c.PrintResult(map[string]any{
			"cliVersion": Version,
			"apiVersion": runtimeinfo.APIVersion,
			"install":    FindInstallHint(),
		})
	case "doctor":
		return cmdDoctor(c)
	case "capabilities":
		return cmdCapabilities(c)
	case "pair":
		return cmdPair(c, rest)
	case "auth":
		return cmdAuth(c, rest, opts)
	case "projects":
		return cmdProjects(c, rest, opts)
	case "project":
		return cmdProject(c, rest, opts)
	case "status":
		return cmdStatus(c, rest)
	case "changes":
		return cmdChanges(c, rest)
	case "diff":
		return cmdDiff(c, rest)
	case "history":
		return cmdHistory(c, rest)
	case "commit":
		return cmdCommit(c, rest, opts)
	case "branches":
		return cmdBranches(c, rest, opts)
	case "files":
		return cmdFiles(c, rest, opts)
	case "file":
		return cmdStandaloneFile(c, rest, opts)
	case "remote":
		return cmdRemote(c, rest, opts)
	case "github":
		return cmdGitHub(c, rest, opts)
	case "settings":
		return cmdSettings(c, rest, opts)
	case "ops":
		return cmdOps(c, rest)
	case "clone":
		return cmdClone(c, rest, opts)
	case "ui":
		return cmdUI(c, rest)
	case "dashboard":
		return cmdDashboard(c, rest)
	case "tools":
		return cmdTools(c, rest, opts)
	default:
		fmt.Fprintf(c.Err, "未知命令：%s\n", cmd)
		printHelp(c.Err)
		return ExitUserError
	}
}

func printHelp(w io.Writer) {
	fmt.Fprint(w, `forklyctl — Forkly Agent / 命令行客户端

用法:
  forklyctl [--json] [--yes] <command> [args]

全局:
  version, doctor, capabilities, pair, auth status|revoke

项目:
  projects list
  project current|inspect|add|create|relocate|remove|hide-rules
  status [id]
  changes list [id]
  diff [id] --path <path>
  history list|show [id]
  commit [id] --paths a,b --message "..."
  branches list|create|switch|rename|delete
  files tree|read|write|mkdir|create|rename|delete|upload-asset
  file open|read|write|meta [--path|--id]
  remote status|link|unlink|fetch|pull|push|create-repo
  clone --url <url> --parent <dir> [--name <name>]
  github account|repos|device|pat|logout
  settings get|set
  dashboard activity
  ops status|cancel <id>
  ui open-console|reveal --path <path>
  tools install-cli [--scope user|system]
`)
}

func ensureReady(c *Client) error {
	return c.Ensure(DefaultEnsureTimeout())
}

func cmdDoctor(c *Client) int {
	report := map[string]any{
		"cliVersion": Version,
		"dataDir":    c.DataDir,
		"install":    FindInstallHint(),
		"paired":     c.Token != "",
	}
	info, err := c.Discover()
	if err != nil {
		report["runtime"] = map[string]any{"ok": false, "error": err.Error()}
	} else {
		report["runtime"] = info
		c.BaseURL = info.BaseURL
		if h, err := c.Health(); err != nil {
			report["health"] = map[string]any{"ok": false, "error": err.Error()}
		} else {
			report["health"] = h
		}
	}
	return c.PrintResult(report)
}

func cmdCapabilities(c *Client) int {
	caps := []map[string]any{
		{"command": "projects list", "scope": agentauth.ScopeRead, "headless": true},
		{"command": "project add", "scope": agentauth.ScopeProjectAdmin, "headless": true},
		{"command": "files write", "scope": agentauth.ScopeFileWrite, "headless": true},
		{"command": "files upload-asset", "scope": agentauth.ScopeFileWrite, "headless": true},
		{"command": "file open|read|write", "scope": agentauth.ScopeFileWrite, "headless": true},
		{"command": "commit", "scope": agentauth.ScopeCommit, "headless": true},
		{"command": "branches *", "scope": agentauth.ScopeBranchWrite, "headless": true},
		{"command": "remote *", "scope": agentauth.ScopeRemoteWrite, "headless": true},
		{"command": "github *", "scope": agentauth.ScopeAccountAdmin, "headless": true},
		{"command": "tools install-cli", "scope": "", "headless": true},
		{"command": "ui *", "scope": agentauth.ScopeUIControl, "headless": false},
	}
	return c.PrintResult(map[string]any{
		"apiVersion": runtimeinfo.APIVersion,
		"commands":   caps,
		"presets":    agentauth.PresetScopes,
		"danger": map[string]any{
			"blocked": []string{"reset", "force_push", "auto_merge", "auto_rebase", "auto_stash", "delete_project_disk"},
		},
	})
}

func cmdPair(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	preset := "collaborate"
	name := "Cursor / Codex"
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--preset":
			i++
			if i < len(args) {
				preset = args[i]
			}
		case "--name":
			i++
			if i < len(args) {
				name = args[i]
			}
		}
	}
	var start map[string]any
	if err := c.doJSON(http.MethodPost, "/local-api/v1/agent/pair/start", map[string]any{
		"clientName": name, "preset": preset,
	}, &start, false); err != nil {
		return c.PrintErr(err)
	}
	pairID, _ := start["pairId"].(string)
	code, _ := start["userCode"].(string)
	deviceSecret, _ := start["deviceSecret"].(string)
	if pairID == "" || code == "" || deviceSecret == "" {
		return c.PrintErr(fmt.Errorf("配对启动响应不完整"))
	}
	fmt.Fprintf(c.Err, "请在 Forkly 设置 →「命令行与 AI 工具」中核对配对码：%s\n", code)
	fmt.Fprintf(c.Err, "等待批准…\n")
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		var claim map[string]any
		err := c.doJSON(http.MethodPost, "/local-api/v1/agent/pair/claim", map[string]any{
			"pairId": pairID, "userCode": code, "deviceSecret": deviceSecret,
		}, &claim, false)
		if err != nil {
			if ae, ok := err.(*APIError); ok && ae.Status == http.StatusConflict {
				time.Sleep(time.Second)
				continue
			}
			return c.PrintErr(err)
		}
		if claim["status"] == "pending" {
			time.Sleep(time.Second)
			continue
		}
		token, _ := claim["token"].(string)
		clientID, _ := claim["clientId"].(string)
		var scopes []string
		if raw, ok := claim["scopes"].([]any); ok {
			for _, s := range raw {
				scopes = append(scopes, fmt.Sprint(s))
			}
		}
		if err := c.SaveAuth(clientID, token, scopes); err != nil {
			return c.PrintErr(err)
		}
		if info, err := c.Discover(); err == nil {
			_ = c.SaveTrustedRuntime(info)
		}
		return c.PrintResult(map[string]any{
			"ok": true, "clientId": clientID, "scopes": scopes, "message": "配对成功",
		})
	}
	return c.PrintErr(fmt.Errorf("配对超时"))
}

func cmdAuth(c *Client, args []string, opts Options) int {
	if len(args) == 0 {
		return c.PrintErr(fmt.Errorf("用法: auth status|revoke"))
	}
	switch args[0] {
	case "status":
		return c.PrintResult(map[string]any{"paired": c.Token != "", "authFile": c.authPath()})
	case "revoke":
		if !opts.Yes {
			return c.PrintErr(fmt.Errorf("请加 --yes 确认撤销本地配对"))
		}
		_ = c.ClearAuth()
		return c.PrintResult(map[string]any{"ok": true})
	default:
		return c.PrintErr(fmt.Errorf("未知 auth 子命令"))
	}
}

func resolveProjectID(c *Client, maybe string) (string, error) {
	if maybe != "" && maybe != "." {
		return maybe, nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	var list struct {
		Projects []struct {
			ID   string `json:"id"`
			Path string `json:"path"`
		} `json:"projects"`
	}
	if err := c.doJSON(http.MethodGet, "/local-api/v1/projects", nil, &list, true); err != nil {
		return "", err
	}
	cwd = filepath.Clean(cwd)
	best := ""
	bestLen := -1
	for _, p := range list.Projects {
		pp := filepath.Clean(p.Path)
		if cwd == pp || strings.HasPrefix(cwd, pp+string(filepath.Separator)) {
			if len(pp) > bestLen {
				best = p.ID
				bestLen = len(pp)
			}
		}
	}
	if best == "" {
		return "", fmt.Errorf("当前目录未登记到 Forkly，请先 project add .")
	}
	return best, nil
}

func cmdProjects(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 || args[0] == "list" {
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/projects", nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	}
	return c.PrintErr(fmt.Errorf("用法: projects list"))
}

func cmdProject(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		return c.PrintErr(fmt.Errorf("缺少子命令"))
	}
	switch args[0] {
	case "current":
		id, err := resolveProjectID(c, "")
		if err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(map[string]any{"id": id})
	case "inspect":
		path := "."
		if len(args) > 1 {
			path = args[1]
		}
		abs, _ := filepath.Abs(path)
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/inspect", map[string]any{"path": abs}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "add", "create":
		path := "."
		name := ""
		initGit := true
		create := args[0] == "create"
		for i := 1; i < len(args); i++ {
			switch args[i] {
			case "--path":
				i++
				if i < len(args) {
					path = args[i]
				}
			case "--name":
				i++
				if i < len(args) {
					name = args[i]
				}
			case "--no-init":
				initGit = false
			default:
				if !strings.HasPrefix(args[i], "-") {
					path = args[i]
				}
			}
		}
		abs, _ := filepath.Abs(path)
		body := map[string]any{"path": abs, "init": initGit, "create": create}
		if name != "" {
			body["name"] = name
		}
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects", body, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "relocate":
		if len(args) < 3 {
			return c.PrintErr(fmt.Errorf("用法: project relocate <id> <newPath>"))
		}
		abs, _ := filepath.Abs(args[2])
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+args[1]+"/relocate", map[string]any{"path": abs}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "remove", "remove-registration":
		if len(args) < 2 {
			return c.PrintErr(fmt.Errorf("用法: project remove <id> --yes"))
		}
		if !opts.Yes {
			return c.PrintErr(fmt.Errorf("请加 --yes 确认取消登记（不删磁盘文件）"))
		}
		var out any
		if err := c.doJSON(http.MethodDelete, "/local-api/v1/projects/"+args[1], map[string]any{}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "hide-rules":
		if len(args) < 2 {
			return c.PrintErr(fmt.Errorf("用法: project hide-rules <id> --set a,b"))
		}
		id := args[1]
		rules := []string{}
		for i := 2; i < len(args); i++ {
			if args[i] == "--set" && i+1 < len(args) {
				rules = SplitCSV(args[i+1])
			}
		}
		var out any
		if err := c.doJSON(http.MethodPut, "/local-api/v1/projects/"+id, map[string]any{"hideRules": rules}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("未知 project 子命令"))
	}
}

func cmdStatus(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	id, err := resolveProjectID(c, first(args))
	if err != nil {
		return c.PrintErr(err)
	}
	var out any
	if err := c.doJSON(http.MethodGet, "/local-api/v1/projects/"+id+"/status", nil, &out, true); err != nil {
		return c.PrintErr(err)
	}
	return c.PrintResult(out)
}

func cmdChanges(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	rest := args
	if len(rest) > 0 && rest[0] == "list" {
		rest = rest[1:]
	}
	id, err := resolveProjectID(c, first(rest))
	if err != nil {
		return c.PrintErr(err)
	}
	var out any
	if err := c.doJSON(http.MethodGet, "/local-api/v1/projects/"+id+"/status", nil, &out, true); err != nil {
		return c.PrintErr(err)
	}
	return c.PrintResult(out)
}

func cmdDiff(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	id := ""
	path := ""
	for i := 0; i < len(args); i++ {
		if args[i] == "--path" && i+1 < len(args) {
			path = args[i+1]
			i++
			continue
		}
		if !strings.HasPrefix(args[i], "-") && id == "" {
			id = args[i]
		}
	}
	var err error
	id, err = resolveProjectID(c, id)
	if err != nil {
		return c.PrintErr(err)
	}
	if path == "" {
		return c.PrintErr(fmt.Errorf("需要 --path"))
	}
	var out any
	if err := c.doJSON(http.MethodGet, "/local-api/v1/projects/"+id+"/diff?path="+QueryEscape(path), nil, &out, true); err != nil {
		return c.PrintErr(err)
	}
	return c.PrintResult(out)
}

func cmdHistory(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		id, err := resolveProjectID(c, first(args[1:]))
		if err != nil {
			return c.PrintErr(err)
		}
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/projects/"+id+"/history", nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "show":
		if len(args) < 2 {
			return c.PrintErr(fmt.Errorf("用法: history show <sha> [projectId] [--path P]"))
		}
		sha := args[1]
		rest := args[2:]
		path := flagValue(rest, "--path")
		idArg := firstNonFlag(rest)
		id, err := resolveProjectID(c, idArg)
		if err != nil {
			return c.PrintErr(err)
		}
		var out any
		urlPath := "/local-api/v1/projects/" + id + "/commits/" + sha
		if path != "" {
			urlPath += "/diff?path=" + QueryEscape(path)
		}
		if err := c.doJSON(http.MethodGet, urlPath, nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("用法: history list|show"))
	}
}

func cmdCommit(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	id := ""
	paths := []string{}
	msg := ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--paths":
			i++
			if i < len(args) {
				paths = SplitCSV(args[i])
			}
		case "--message", "-m":
			i++
			if i < len(args) {
				msg = args[i]
			}
		default:
			if !strings.HasPrefix(args[i], "-") && id == "" {
				id = args[i]
			}
		}
	}
	var err error
	id, err = resolveProjectID(c, id)
	if err != nil {
		return c.PrintErr(err)
	}
	if msg == "" || len(paths) == 0 {
		return c.PrintErr(fmt.Errorf("需要 --paths 与 --message"))
	}
	var out any
	if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/commit", map[string]any{
		"message": msg, "paths": paths,
	}, &out, true); err != nil {
		return c.PrintErr(err)
	}
	return c.PrintResult(out)
}

func cmdBranches(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		args = []string{"list"}
	}
	sub := args[0]
	rest := args[1:]
	id, err := resolveProjectID(c, "")
	if err != nil && sub != "list" {
		// allow id as first arg
	}
	// parse optional project id as first non-flag
	for i, a := range rest {
		if !strings.HasPrefix(a, "-") {
			if id == "" || (sub != "list" && i == 0) {
				if pid, e := resolveProjectID(c, a); e == nil {
					id = pid
					rest = append(rest[:i], rest[i+1:]...)
				}
			}
			break
		}
	}
	if id == "" {
		id, err = resolveProjectID(c, "")
		if err != nil {
			return c.PrintErr(err)
		}
	}
	switch sub {
	case "list":
		q := ""
		for i := 0; i < len(rest); i++ {
			if rest[i] == "--q" && i+1 < len(rest) {
				q = rest[i+1]
			}
		}
		path := "/local-api/v1/projects/" + id + "/branches"
		if q != "" {
			path += "?q=" + QueryEscape(q)
		}
		var out any
		if err := c.doJSON(http.MethodGet, path, nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "create":
		name := first(rest)
		if name == "" {
			return c.PrintErr(fmt.Errorf("需要分支名"))
		}
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/branches/create", map[string]any{
			"name": name,
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "switch":
		name := first(rest)
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/branches/switch", map[string]any{"name": name}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "rename":
		if len(rest) < 2 {
			return c.PrintErr(fmt.Errorf("用法: branches rename <old> <new>"))
		}
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/branches/rename", map[string]any{
			"oldName": rest[0], "newName": rest[1],
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "delete":
		name := first(rest)
		if !opts.Yes {
			return c.PrintErr(fmt.Errorf("请加 --yes 确认删除分支"))
		}
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/branches/delete", map[string]any{"name": name}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("未知 branches 子命令"))
	}
}

func cmdFiles(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		return c.PrintErr(fmt.Errorf("用法: files tree|read|write|mkdir|rename|delete"))
	}
	sub := args[0]
	rest := args[1:]
	id, err := resolveProjectID(c, "")
	if err != nil {
		return c.PrintErr(err)
	}
	switch sub {
	case "tree":
		src := "worktree"
		for i := 0; i < len(rest); i++ {
			if rest[i] == "--source" && i+1 < len(rest) {
				src = rest[i+1]
			}
		}
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/projects/"+id+"/tree?source="+QueryEscape(src), nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "read":
		path := flagValue(rest, "--path")
		if path == "" {
			path = first(rest)
		}
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/projects/"+id+"/content?path="+QueryEscape(path), nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "write":
		path := flagValue(rest, "--path")
		content := flagValue(rest, "--content")
		rev := flagValue(rest, "--revision")
		if path == "" {
			return c.PrintErr(fmt.Errorf("需要 --path"))
		}
		if content == "" {
			raw, err := io.ReadAll(os.Stdin)
			if err != nil {
				return c.PrintErr(err)
			}
			content = string(raw)
		}
		body := map[string]any{"path": path, "content": content}
		if rev != "" {
			body["revision"] = rev
		}
		var out any
		if err := c.doJSON(http.MethodPut, "/local-api/v1/projects/"+id+"/content", body, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "mkdir":
		path := flagValue(rest, "--path")
		if path == "" {
			path = first(rest)
		}
		parent, name := splitParentName(path)
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/entries", map[string]any{
			"kind": "dir", "parentPath": parent, "name": name,
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "create":
		path := flagValue(rest, "--path")
		if path == "" {
			path = first(rest)
		}
		parent, name := splitParentName(path)
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/entries", map[string]any{
			"kind": "file", "parentPath": parent, "name": name,
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "rename":
		from := flagValue(rest, "--from")
		to := flagValue(rest, "--to")
		if from == "" || to == "" {
			return c.PrintErr(fmt.Errorf("需要 --from 与 --to（to 为新文件名，不含路径）"))
		}
		var out any
		if err := c.doJSON(http.MethodPatch, "/local-api/v1/projects/"+id+"/entries", map[string]any{
			"path": from, "name": to,
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "delete":
		path := flagValue(rest, "--path")
		if path == "" {
			path = first(rest)
		}
		if !opts.Yes {
			return c.PrintErr(fmt.Errorf("请加 --yes 确认删除"))
		}
		var out any
		if err := c.doJSON(http.MethodDelete, "/local-api/v1/projects/"+id+"/entries", map[string]any{
			"path": path,
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "upload-asset":
		mdPath := flagValue(rest, "--markdown")
		filePath := flagValue(rest, "--file")
		if mdPath == "" || filePath == "" {
			return c.PrintErr(fmt.Errorf("用法: files upload-asset --markdown <md> --file <image>"))
		}
		var out any
		if err := c.doMultipart(http.MethodPost, "/local-api/v1/projects/"+id+"/assets", "file", filePath, map[string]string{
			"path": mdPath,
		}, &out); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("未知 files 子命令"))
	}
}

func cmdStandaloneFile(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		return c.PrintErr(fmt.Errorf("用法: file open|meta|read|write [--path P|--id ID]"))
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "open":
		path := flagValue(rest, "--path")
		if path == "" {
			path = firstNonFlag(rest)
		}
		if path == "" {
			return c.PrintErr(fmt.Errorf("需要 --path"))
		}
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/local-files/open", map[string]any{"path": path}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "meta":
		id := flagValue(rest, "--id")
		if id == "" {
			return c.PrintErr(fmt.Errorf("需要 --id"))
		}
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/local-files/"+id, nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "read":
		id := flagValue(rest, "--id")
		if id == "" {
			return c.PrintErr(fmt.Errorf("需要 --id（先 file open）"))
		}
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/local-files/"+id+"/content", nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "write":
		id := flagValue(rest, "--id")
		rev := flagValue(rest, "--revision")
		content := flagValue(rest, "--content")
		if id == "" {
			return c.PrintErr(fmt.Errorf("需要 --id"))
		}
		if content == "" {
			raw, err := io.ReadAll(os.Stdin)
			if err != nil {
				return c.PrintErr(err)
			}
			content = string(raw)
		}
		body := map[string]any{"content": content}
		if rev != "" {
			body["revision"] = rev
		}
		var out any
		if err := c.doJSON(http.MethodPut, "/local-api/v1/local-files/"+id+"/content", body, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("未知 file 子命令"))
	}
}

func cmdTools(c *Client, args []string, opts Options) int {
	if len(args) == 0 {
		return c.PrintErr(fmt.Errorf("用法: tools install-cli [--scope user|system] | cli-status"))
	}
	switch args[0] {
	case "install-cli":
		scope := flagValue(args[1:], "--scope")
		if scope == "" {
			scope = "user"
		}
		res, err := cliinstall.Install(scope)
		if err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(res)
	case "cli-status":
		return c.PrintResult(cliinstall.Status())
	default:
		return c.PrintErr(fmt.Errorf("未知 tools 子命令"))
	}
}

func cmdRemote(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		args = []string{"status"}
	}
	sub := args[0]
	rest := args[1:]
	id, err := resolveProjectID(c, firstNonFlag(rest))
	if err != nil {
		return c.PrintErr(err)
	}
	switch sub {
	case "status":
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/projects/"+id+"/remote", nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "link":
		url := flagValue(rest, "--url")
		replace := hasFlag(rest, "--replace")
		useExisting := hasFlag(rest, "--use-existing")
		body := map[string]any{"remoteName": "origin", "replace": replace, "useExisting": useExisting}
		if url != "" {
			body["url"] = url
		}
		var out any
		if err := c.doJSON(http.MethodPut, "/local-api/v1/projects/"+id+"/remote", body, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "unlink":
		if !opts.Yes {
			return c.PrintErr(fmt.Errorf("请加 --yes 确认解除关联"))
		}
		del := hasFlag(rest, "--delete-git-remote")
		var out any
		if err := c.doJSON(http.MethodDelete, "/local-api/v1/projects/"+id+"/remote", map[string]any{
			"deleteGitRemote": del,
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "fetch", "pull", "push":
		var out map[string]any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/remote/"+sub, map[string]any{}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		if hasFlag(rest, "--no-wait") {
			return c.PrintResult(out)
		}
		opID, _ := out["operationId"].(string)
		if opID == "" {
			return c.PrintResult(out)
		}
		return waitOp(c, opID)
	case "create-repo":
		name := flagValue(rest, "--name")
		desc := flagValue(rest, "--description")
		private := !hasFlag(rest, "--public")
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/remote/create-repo", map[string]any{
			"name": name, "description": desc, "private": private,
		}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("未知 remote 子命令"))
	}
}

func waitOp(c *Client, id string) int {
	deadline := time.Now().Add(10 * time.Minute)
	for time.Now().Before(deadline) {
		var op map[string]any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/operations/"+id, nil, &op, true); err != nil {
			return c.PrintErr(err)
		}
		st, _ := op["status"].(string)
		switch st {
		case "succeeded":
			return c.PrintResult(op)
		case "failed", "canceled":
			msg, _ := op["error"].(string)
			if msg == "" {
				msg = st
			}
			return c.PrintErr(fmt.Errorf("%s", msg))
		}
		time.Sleep(800 * time.Millisecond)
	}
	return c.PrintErr(fmt.Errorf("操作超时"))
}

func cmdClone(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	url := flagValue(args, "--url")
	parent := flagValue(args, "--parent")
	name := flagValue(args, "--name")
	if url == "" || parent == "" {
		return c.PrintErr(fmt.Errorf("需要 --url 与 --parent"))
	}
	abs, _ := filepath.Abs(parent)
	body := map[string]any{"url": url, "parentPath": abs}
	if name != "" {
		body["name"] = name
	}
	var out any
	if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/clone", body, &out, true); err != nil {
		return c.PrintErr(err)
	}
	return c.PrintResult(out)
}

func cmdGitHub(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		args = []string{"account"}
	}
	switch args[0] {
	case "account":
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/settings/github", nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "repos":
		q := flagValue(args[1:], "--q")
		path := "/local-api/v1/github/repos"
		if q != "" {
			path += "?q=" + QueryEscape(q)
		}
		var out any
		if err := c.doJSON(http.MethodGet, path, nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "pat":
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			return c.PrintErr(err)
		}
		token := strings.TrimSpace(string(raw))
		if token == "" {
			return c.PrintErr(fmt.Errorf("请通过 stdin 提供 PAT"))
		}
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/github/pat", map[string]any{"token": token}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "logout":
		if !opts.Yes {
			return c.PrintErr(fmt.Errorf("请加 --yes 确认退出 GitHub 账号"))
		}
		var out any
		if err := c.doJSON(http.MethodDelete, "/local-api/v1/settings/github", map[string]any{}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "device":
		if len(args) < 2 {
			return c.PrintErr(fmt.Errorf("用法: github device start|status|cancel"))
		}
		switch args[1] {
		case "start":
			var out any
			if err := c.doJSON(http.MethodPost, "/local-api/v1/github/device/start", map[string]any{}, &out, true); err != nil {
				return c.PrintErr(err)
			}
			return c.PrintResult(out)
		case "status":
			flow := flagValue(args[2:], "--flow")
			var out any
			if err := c.doJSON(http.MethodGet, "/local-api/v1/github/device/status?flowId="+QueryEscape(flow), nil, &out, true); err != nil {
				return c.PrintErr(err)
			}
			return c.PrintResult(out)
		case "cancel":
			flow := flagValue(args[2:], "--flow")
			var out any
			if err := c.doJSON(http.MethodPost, "/local-api/v1/github/device/cancel", map[string]any{"flowId": flow}, &out, true); err != nil {
				return c.PrintErr(err)
			}
			return c.PrintResult(out)
		}
	}
	return c.PrintErr(fmt.Errorf("未知 github 子命令"))
}

func cmdSettings(c *Client, args []string, opts Options) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 || args[0] == "get" {
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/settings", nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	}
	if args[0] == "set" {
		name := flagValue(args[1:], "--name")
		email := flagValue(args[1:], "--email")
		theme := flagValue(args[1:], "--theme")
		body := map[string]any{}
		identity := map[string]any{}
		if name != "" {
			identity["name"] = name
		}
		if email != "" {
			identity["email"] = email
		}
		if len(identity) > 0 {
			body["identity"] = identity
		}
		prefs := map[string]any{}
		if theme != "" {
			prefs["theme"] = theme
		}
		if hasFlag(args[1:], "--background-checks") {
			prefs["backgroundChecks"] = true
		}
		if hasFlag(args[1:], "--no-background-checks") {
			prefs["backgroundChecks"] = false
		}
		if len(prefs) > 0 {
			body["preferences"] = prefs
		}
		var out any
		if err := c.doJSON(http.MethodPut, "/local-api/v1/settings", body, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	}
	return c.PrintErr(fmt.Errorf("用法: settings get|set"))
}

func cmdOps(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) < 2 {
		return c.PrintErr(fmt.Errorf("用法: ops status|cancel <id>"))
	}
	id := args[1]
	switch args[0] {
	case "status":
		var out any
		if err := c.doJSON(http.MethodGet, "/local-api/v1/operations/"+id, nil, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	case "cancel":
		var out any
		if err := c.doJSON(http.MethodDelete, "/local-api/v1/operations/"+id, map[string]any{}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("未知 ops 子命令"))
	}
}

func cmdUI(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	if len(args) == 0 {
		return c.PrintErr(fmt.Errorf("用法: ui open-console|reveal"))
	}
	switch args[0] {
	case "open-console":
		return c.PrintResult(map[string]any{
			"ok": false, "code": "gui_only",
			"message": "请从 Forkly 托盘打开控制台；CLI 不直接打开浏览器会话",
		})
	case "reveal":
		id, err := resolveProjectID(c, "")
		if err != nil {
			return c.PrintErr(err)
		}
		path := flagValue(args[1:], "--path")
		var out any
		if err := c.doJSON(http.MethodPost, "/local-api/v1/projects/"+id+"/reveal", map[string]any{"path": path}, &out, true); err != nil {
			return c.PrintErr(err)
		}
		return c.PrintResult(out)
	default:
		return c.PrintErr(fmt.Errorf("未知 ui 子命令"))
	}
}

func cmdDashboard(c *Client, args []string) int {
	if err := ensureReady(c); err != nil {
		return c.PrintErr(err)
	}
	days := "30"
	if v := flagValue(args, "--days"); v != "" {
		days = v
	}
	var out any
	if err := c.doJSON(http.MethodGet, "/local-api/v1/dashboard/activity?days="+QueryEscape(days), nil, &out, true); err != nil {
		return c.PrintErr(err)
	}
	return c.PrintResult(out)
}

func first(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return args[0]
}

func firstNonFlag(args []string) string {
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			return a
		}
	}
	return ""
}

func flagValue(args []string, name string) string {
	for i := 0; i < len(args); i++ {
		if args[i] == name && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(args[i], name+"=") {
			return strings.TrimPrefix(args[i], name+"=")
		}
	}
	return ""
}

func hasFlag(args []string, name string) bool {
	for _, a := range args {
		if a == name {
			return true
		}
	}
	return false
}

func splitParentName(path string) (parent, name string) {
	path = strings.Trim(strings.ReplaceAll(path, "\\", "/"), "/")
	if path == "" {
		return ".", ""
	}
	i := strings.LastIndex(path, "/")
	if i < 0 {
		return ".", path
	}
	return path[:i], path[i+1:]
}

// Silence unused import in case build tags strip something.
var _ = json.Marshal
