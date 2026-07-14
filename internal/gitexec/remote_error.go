package gitexec

import (
	"fmt"
	"strings"
)

// RemoteError is a structured error for remote sync operations.
type RemoteError struct {
	Code    string
	Message string
	Cause   error
}

func (e *RemoteError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

func (e *RemoteError) Unwrap() error { return e.Cause }

const (
	ErrCodeAuthRequired       = "auth_required"
	ErrCodeTokenExpired       = "token_expired"
	ErrCodeRemoteConflict     = "remote_conflict"
	ErrCodePermissionDenied   = "permission_denied"
	ErrCodeRepositoryNotFound = "repository_not_found"
	ErrCodeOffline            = "offline"
	ErrCodeTimeout            = "timeout"
	ErrCodeDirtyWorktree      = "dirty_worktree"
	ErrCodeNoUpstream         = "no_upstream"
	ErrCodeNonFastForward     = "non_fast_forward"
	ErrCodeDiverged           = "diverged"
	ErrCodeOperationBusy      = "operation_busy"
	ErrCodeInvalidURL         = "invalid_url"
	ErrCodeUnsupportedRemote  = "unsupported_remote"
)

func remoteErr(code, message string) error {
	return &RemoteError{Code: code, Message: message}
}

func AsRemoteError(err error) *RemoteError {
	if err == nil {
		return nil
	}
	if e, ok := err.(*RemoteError); ok {
		return e
	}
	return nil
}

func mapRemoteGitError(stderr string, err error, timeout bool) error {
	if timeout {
		return remoteErr(ErrCodeTimeout, "Git 操作超时")
	}
	msg := strings.TrimSpace(stderr)
	lower := strings.ToLower(msg + " " + errString(err))
	switch {
	case strings.Contains(lower, "authentication failed") ||
		strings.Contains(lower, "could not read username") ||
		strings.Contains(lower, "invalid username or password") ||
		strings.Contains(lower, "403"):
		return remoteErr(ErrCodeAuthRequired, "GitHub 认证失败，请重新连接账号")
	case strings.Contains(lower, "permission denied") || strings.Contains(lower, "write access"):
		return remoteErr(ErrCodePermissionDenied, "没有推送到该仓库的权限")
	case strings.Contains(lower, "repository not found") || strings.Contains(lower, "not found"):
		return remoteErr(ErrCodeRepositoryNotFound, "找不到远端仓库或无权访问")
	case strings.Contains(lower, "non-fast-forward") || strings.Contains(lower, "fetch first"):
		return remoteErr(ErrCodeNonFastForward, "远端有更新，请先拉取后再推送")
	case strings.Contains(lower, "rejected") && strings.Contains(lower, "failed to push"):
		return remoteErr(ErrCodeNonFastForward, "推送被拒绝，远端可能有新提交")
	case strings.Contains(lower, "could not resolve host") ||
		strings.Contains(lower, "failed to connect") ||
		strings.Contains(lower, "network is unreachable"):
		return remoteErr(ErrCodeOffline, "无法连接 GitHub，请检查网络")
	case strings.Contains(lower, "not possible to fast-forward") ||
		strings.Contains(lower, "divergent branches"):
		return remoteErr(ErrCodeDiverged, "本地与远端已分叉，无法仅用快进同步")
	default:
		if msg == "" {
			msg = errString(err)
		}
		if msg == "" {
			msg = "远端操作失败"
		}
		return remoteErr("remote_failed", msg)
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func redactSecrets(s string) string {
	// Never leak tokens that might appear in accidental URL forms.
	out := s
	for _, prefix := range []string{"ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"} {
		for {
			i := strings.Index(out, prefix)
			if i < 0 {
				break
			}
			j := i + len(prefix)
			for j < len(out) && out[j] != ' ' && out[j] != '\n' && out[j] != '\t' && out[j] != '"' && out[j] != '\'' {
				j++
			}
			out = out[:i] + prefix + "***" + out[j:]
		}
	}
	return out
}

func fmtRemote(a ...any) string {
	return fmt.Sprint(a...)
}
