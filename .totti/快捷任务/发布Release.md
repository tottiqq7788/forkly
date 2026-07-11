# 任务：发布 Forkly GitHub Release

## 目标

根据仓库当前版本与 `dist/` 中**同版本的最新安装包**，在 GitHub 创建（或更新）对应 Release，并上传安装包资源。
**必须严格执行以下全部流程，不提问、不等待确认。**

## 项目信息

- 项目名称：forkly
- 项目路径：`/Users/totti/个人/project/mod/forkly`
- 默认分支：`main`
- 远程地址：`https://github.com/tottiqq7788/forkly.git`
- 版本文件：仓库根目录 `VERSION`（权威来源）
- 安装包目录：`dist/`（不入库，仅本地产物）

## 版本与产物规则

1. 读取 `VERSION`，记为 `VER`（例如 `0.1.6`），对应 tag 为 `v${VER}`。
2. **只处理与 `VER` 同版本的安装包**；旧版本（如 `0.1.5`、`0.1.0`）一律跳过，不要上传。
3. 当前优先支持的 macOS 产物命名：

   ```text
   dist/Forkly-${VER}-macOS-arm64.dmg
   dist/Forkly-${VER}-macOS-x64.dmg
   ```

4. Windows：

   - **默认忽略**。不要为了凑 Release 去打包或上传 Windows。
   - **仅当** `dist/` 里已存在与 `VER` 同版本的 Windows 安装包时，才一并上传。
   - 可识别的命名示例（有则传，无则跳过）：
     - `dist/Forkly-${VER}-windows-x64.exe`
     - `dist/Forkly-${VER}-windows-arm64.exe`
     - `dist/Forkly-${VER}-Windows-x64.msi`
     - 其他明确包含 `${VER}` 且平台为 windows/win 的安装包

5. 若 `dist/` 中缺少 `VER` 对应的 macOS 包：

   - 先按 [执行mac打包.md](./执行mac打包.md) 打出当前架构包（默认 `ARCH=arm64`）。
   - 本机是 Apple Silicon 时不要强行交叉打 x64，除非用户明确要求。
   - 打完后再继续本任务。

6. 工作区若有未提交变更：

   - **不要**在本任务里擅自 `git commit` / bump 版本。
   - Release 仍以当前 `VERSION` 与已存在的 `v${VER}` tag 为准。
   - 若本地代码与 tag 明显不一致且会影响安装包内容，先说明风险，并优先用刚打出的、与当前工作区一致的包上传（仍挂到 `v${VER}`）。

## 执行要求

### 1. 确认版本、tag、远程

```bash
cd /Users/totti/个人/project/mod/forkly
cat VERSION
git status --short --branch
git remote -v
git rev-parse "v$(cat VERSION)" 2>/dev/null || true
git log -1 --oneline --decorate
gh release view "v$(cat VERSION)" 2>/dev/null || echo "release 尚不存在"
```

要求：

- `origin` 指向 `https://github.com/tottiqq7788/forkly.git`
- 本地或远程已存在 tag `v${VER}`（由「提交 git」任务创建）。若 tag 不存在：先 `git fetch --tags`；仍不存在则停止并提示先执行提交任务打 tag，**不要**在本任务里新建版本号。

### 2. 收集本版本待上传文件

```bash
VER=$(cat VERSION)
ls -lh dist/Forkly-${VER}-* 2>/dev/null || true
```

筛选规则：

- 必须至少有一个 macOS 包：`Forkly-${VER}-macOS-*.dmg`
- 可选追加同版本 Windows 包（见上文）
- **禁止**把其他版本的 dmg/exe 加进上传列表

将最终文件列表记为 `ASSETS`。

### 3. 生成 Release 说明

优先从该 tag 的 commit message 提取变更摘要：

```bash
git log -1 --format='%s%n%b' "v${VER}"
```

Release 正文用中文，建议结构：

```markdown
## 概要
<一句话说明本版本>

## 安装
- macOS：下载对应架构的 `.dmg`，拖入「应用程序」
- （若有 Windows 附件再写 Windows 安装说明）

> 若为未签名包，说明首次打开可能需在系统设置中允许。

## 变更
<从 tag 提交说明整理的要点；可按 ✅/🔧/🐛 归类>

## 资源
| 文件 | 平台 | 说明 |
|------|------|------|
| ... | ... | ... |
```

标题固定为：`Forkly v${VER}`。

### 4. 创建或更新 Release

**若 Release 不存在：**

```bash
gh release create "v${VER}" \
  --title "Forkly v${VER}" \
  --notes "$(cat <<'EOF'
...正文...
EOF
)" \
  <ASSETS...>
```

**若 Release 已存在：**

- 用 `gh release upload "v${VER}" <file> --clobber` 上传/覆盖同名资源
- 用 `gh release edit "v${VER}" --title "..." --notes "..."` 更新说明（可选但推荐与最新包一致）
- **不要**删除历史 Release；**不要**给旧 tag 补传旧包

### 5. 验证并输出结果

```bash
gh release view "v${VER}"
gh release view "v${VER}" --json url,tagName,assets --jq '{url:.url, tag:.tagName, assets:[.assets[].name]}'
```

## 输出要求

- 全程使用中文。
- 明确写出：`VER`、实际上传了哪些文件、跳过了哪些旧版本文件。
- 回复中给出 Release URL。
- 若缺 tag、缺 mac 包、认证失败或 `gh` 报错：停止并说明原因与下一步（例如先跑打包任务或 `gh auth login`）。
- 不要把 GitHub Token 写入仓库文件。
- 不要上传 `dist/` 以外的无关大文件；不要上传源码 zip 以外的重复物（GitHub 会自动附带 Source code 归档即可）。

## 验收标准

- GitHub 上存在 `v${VER}` Release
- 附件仅包含 **当前 VERSION** 的安装包（至少 macOS；Windows 仅在同版本已存在时）
- 未误传旧版本产物
