# 任务：提交 Forkly 代码到 GitHub

## 目标

把当前 Forkly 项目的本地变更整理、提交，并推送到 GitHub 远程仓库。
**每次提交都必须自动递增一个补丁版本号**（如 `0.1.0` → `0.1.1` → `0.1.2`）。
**必须严格执行以下全部流程，不提问、不等待确认。**

## 项目信息

- 项目名称：forkly
- 项目路径：`/Users/totti/个人/project/mod/forkly`
- 默认分支：`main`
- 远程名称：`origin`
- 远程地址：`https://github.com/tottiqq7788/forkly.git`
- 平台：GitHub
- 版本文件：仓库根目录 `VERSION`（权威来源）

## 执行要求

### 1. 确认仓库与远程

```bash
pwd
git status --short --branch
git remote -v
```

若还没有配置远程仓库：

```bash
git remote add origin https://github.com/tottiqq7788/forkly.git
git branch -M main
```

若 `origin` 已存在但地址不正确，先展示当前远程地址并提醒用户确认，不要直接覆盖。

### 2. 检查并分类本次变更

```bash
git status --short
git diff --stat
git diff
git log --oneline -5
```

清晰列出：

- 新增文件
- 修改文件
- 删除文件
- 代码行数变更统计（可用 `git diff --stat`）

### 3. 提交前检查 README（按需）

阅读 [`README.md`](/Users/totti/个人/project/mod/forkly/README.md)，判断本次变更是否需要同步文档：

- **需要改**：公开能力、安装/运行方式、版本定位、功能范围有明显变化时，做对应小幅更新并一并提交。
- **可以不改**：纯交互微调、内部重构、测试/安全修补、改动不大且 README 描述仍准确时，跳过即可。

不要为了「每次都改」而硬改 README。

### 4. 不要提交以下内容

- `dist/`（仓库根目录打包产物）
- `third_party/git/`
- `tools/git-runtime/cache/`
- `web/node_modules/`
- 密钥、Token、日志、临时文件

说明：`internal/webui/dist/` 是内嵌前端构建产物，若本次改了 `web/` 源码，应先 `cd web && npm run build`，再把更新后的 `internal/webui/dist/` 一并提交。

### 5. 提交前必须递增版本号（不可跳过）

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
- 在标准输出打印新版本号（例如 `0.1.2`）

把打印出的新版本号记为 `NEW_VERSION`，后续提交信息与 tag 都要用它。

> 说明：本仓库默认每次提交做 **补丁号 +1**。若本次确属破坏性变更且用户明确要求升主/次版本，再另行调整 `VERSION`，但仍须走 bump 流程并打对应 tag。

### 6. 生成标准、可直接使用的 Git 提交信息

**禁止**只用一两句短说明交差。必须按下列结构写完整正文（空分类可省略该节，但至少保留实际有内容的分类）：

```text
vX.Y.Z | 本次更新概要

✅ 新增：
- …

🔧 优化：
- …

🐛 修复：
- …

📝 文档：
- …

🗑️ 删除：
- …
```

要求：

- 标题第一行：`v${NEW_VERSION} | <一句话概要>`
- 正文按变更事实填写，条目具体、可读
- 优先中文
- 用 HEREDOC 传入 `git commit`，保证多行格式正确

### 7. 执行提交和推送

```bash
git add <相关文件> VERSION internal/app/app.go web/package.json web/package-lock.json web/src/pages/SettingsPage.tsx
# 若改了 web 源码：一并 add internal/webui/dist/
# 若更新了 README：一并 add README.md

git commit -m "$(cat <<'EOF'
vX.Y.Z | 本次更新概要

✅ 新增：
- …

🔧 优化：
- …

🐛 修复：
- …

📝 文档：
- …

🗑️ 删除：
- …
EOF
)"

git tag "v${NEW_VERSION}"
git fetch origin
git pull --no-rebase origin main
git push -u origin main
git push origin "v${NEW_VERSION}"
```

### 8. 推送完成后必须展示结果 + 历史版本总览

先确认状态：

```bash
git status --short --branch
git log --oneline --decorate -5
cat VERSION
```

再**必须**列出近期 Git 版本标签总览（给用户看）：

```bash
git tag -l 'v*' --sort=-v:refname | head -10 | while read t; do
  echo "----"
  echo "$t"
  git log -1 --format='%ci%n%s%n%b' "$t"
done
```

展示要求：

- 列出最近最多 10 个版本标签（`v*`）
- 显示：版本号、提交时间、提交说明（含正文摘要）
- 按版本从新到旧排序
- 在回复用户时用清晰中文列表呈现，方便总览

## 输出要求

- 全程使用中文。
- 先说明将提交哪些类型的变更，并明确写出新版本号 `NEW_VERSION`。
- 回复中应包含完整提交信息正文（或与 commit 一致的摘要），不要只给一行标题。
- 推送成功后展示历史版本总览。
- 如果存在冲突、远程拒绝、认证失败或 hook 失败，停止并说明原因和下一步建议。
- 不要把 GitHub Token 写入仓库文件。
- 不要跳过版本递增；只要执行本任务做提交，就必须生成新版本号并打 tag。
