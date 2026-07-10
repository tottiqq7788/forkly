# 任务：提交 Forkly 代码到 GitHub

## 目标

把当前 Forkly 项目的本地变更整理、提交，并推送到 GitHub 远程仓库。
**每次提交都必须自动递增一个补丁版本号**（如 `0.1.0` → `0.1.1` → `0.1.2`）。

## 项目信息

- 项目名称：forkly
- 项目路径：`/Users/totti/个人/project/mod/forkly`
- 默认分支：`main`
- 远程名称：`origin`
- 远程地址：`https://github.com/tottiqq7788/forkly.git`
- 平台：GitHub
- 版本文件：仓库根目录 `VERSION`（权威来源）

## 执行要求

1. 先确认当前目录是 Forkly 项目根目录：

   ```bash
   pwd
   git status --short --branch
   ```

2. 如果还没有配置远程仓库，按以下信息配置：

   ```bash
   git remote add origin https://github.com/tottiqq7788/forkly.git
   git branch -M main
   ```

   如果 `origin` 已存在但地址不正确，先展示当前远程地址并提醒用户确认，不要直接覆盖。

3. 检查本次将提交的变更：

   ```bash
   git status --short
   git diff --stat
   git diff
   ```

4. 不要提交以下内容：

   - `dist/`
   - `third_party/git/`
   - `tools/git-runtime/cache/`
   - `web/node_modules/`
   - 密钥、Token、日志、临时文件

5. **提交前必须先递增版本号**（每次提交都做，不可跳过）：

   ```bash
   bash scripts/bump-version.sh
   ```

   该脚本会：

   - 读取 `VERSION`，将补丁号 +1（`x.y.z` → `x.y.(z+1)`）
   - 同步更新：
     - `VERSION`
     - `internal/app/app.go`
     - `web/package.json`
     - `web/package-lock.json`（若存在）
     - `web/src/pages/SettingsPage.tsx`
   - `Makefile` 通过 `$(shell cat VERSION)` 读取版本，无需单独改
   - 在标准输出打印新版本号（例如 `0.1.1`）

   把打印出的新版本号记为 `NEW_VERSION`，后续提交信息与 tag 都要用它。

6. 根据变更内容生成清晰的提交信息，优先使用中文，格式建议：

   ```text
   类型：简短说明（vNEW_VERSION）

   说明本次提交解决的问题或完成的目标。
   ```

7. 执行提交和推送：

   ```bash
   git add <相关文件> VERSION internal/app/app.go web/package.json web/package-lock.json web/src/pages/SettingsPage.tsx scripts/bump-version.sh
   git commit -m "<提交信息>"
   git tag "v${NEW_VERSION}"
   git fetch origin
   git pull --no-rebase origin main
   git push -u origin main
   git push origin "v${NEW_VERSION}"
   ```

8. 推送完成后展示：

   ```bash
   git status --short --branch
   git log --oneline --decorate -5
   cat VERSION
   ```

## 输出要求

- 全程使用中文。
- 先说明将提交哪些类型的变更，并明确写出新版本号。
- 如果存在冲突、远程拒绝、认证失败或 hook 失败，停止并说明原因和下一步建议。
- 不要把 GitHub Token 写入仓库文件。
- 不要跳过版本递增；只要执行本任务做提交，就必须生成新版本号。
