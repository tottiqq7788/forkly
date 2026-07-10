# 任务：提交 Forkly 代码到 GitHub

## 目标

把当前 Forkly 项目的本地变更整理、提交，并推送到 GitHub 远程仓库。

## 项目信息

- 项目名称：forkly
- 项目路径：`/Users/totti/个人/project/mod/forkly`
- 默认分支：`main`
- 远程名称：`origin`
- 远程地址：`https://github.com/tottiqq7788/forkly.git`
- 平台：GitHub

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

5. 根据变更内容生成清晰的提交信息，优先使用中文，格式建议：

   ```text
   类型：简短说明

   说明本次提交解决的问题或完成的目标。
   ```

6. 执行提交和推送：

   ```bash
   git add <相关文件>
   git commit -m "<提交信息>"
   git fetch origin
   git pull --no-rebase origin main
   git push -u origin main
   ```

7. 推送完成后展示：

   ```bash
   git status --short --branch
   git log --oneline --decorate -5
   ```

## 输出要求

- 全程使用中文。
- 先说明将提交哪些类型的变更。
- 如果存在冲突、远程拒绝、认证失败或 hook 失败，停止并说明原因和下一步建议。
- 不要把 GitHub Token 写入仓库文件。
