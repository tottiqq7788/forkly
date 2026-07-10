# Forkly GitHub 远程仓库信息

- 项目名称：forkly
- 平台：GitHub
- 默认分支：`main`
- 远程名称：`origin`
- 远程地址：`https://github.com/tottiqq7788/forkly.git`

## 首次初始化参考

如果本地还不是 Git 仓库：

```bash
git init
git branch -M main
git remote add origin https://github.com/tottiqq7788/forkly.git
```

如果需要首次提交：

```bash
git add README.md
git commit -m "first commit"
git push -u origin main
```

## 注意事项

- 不要把 GitHub Token 写入仓库文件。
- 如果 `origin` 已存在，先用 `git remote -v` 查看，不要直接重复添加。
- 如果远程地址错误，先确认后再调整：

  ```bash
  git remote set-url origin https://github.com/tottiqq7788/forkly.git
  ```
