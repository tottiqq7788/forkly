package gitexec

import (
	"fmt"
	"regexp"
	"strings"
)

var objectIDRe = regexp.MustCompile(`(?i)^[0-9a-f]{7,40}$`)

// assertObjectID rejects values that could be parsed as git CLI options.
func assertObjectID(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("缺少提交标识")
	}
	if strings.HasPrefix(id, "-") {
		return fmt.Errorf("提交标识无效")
	}
	if !objectIDRe.MatchString(id) {
		return fmt.Errorf("提交标识无效")
	}
	return nil
}
