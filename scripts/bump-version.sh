#!/usr/bin/env bash
# Bump Forkly patch version (0.1.0 -> 0.1.1) and sync known version sources.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f VERSION ]]; then
  echo "0.1.0" > VERSION
fi

current="$(tr -d '[:space:]' < VERSION)"
if [[ ! "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "invalid VERSION: $current" >&2
  exit 1
fi

major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"
next="${major}.${minor}.$((patch + 1))"

python3 - "$current" "$next" <<'PY'
import pathlib, re, sys

old, new = sys.argv[1], sys.argv[2]
root = pathlib.Path(".")

replacements = [
    (root / "internal/app/app.go", rf'var Version = "{re.escape(old)}"', f'var Version = "{new}"'),
    (root / "web/package.json", rf'("version"\s*:\s*"){re.escape(old)}(")', rf"\g<1>{new}\g<2>"),
    (root / "web/src/pages/SettingsPage.tsx", rf"Forkly {re.escape(old)}", f"Forkly {new}"),
]

updated_files = []
for path, pattern, repl in replacements:
    text = path.read_text(encoding="utf-8")
    next_text, n = re.subn(pattern, repl, text, count=1, flags=re.M)
    if n != 1:
        raise SystemExit(f"failed to update {path}: pattern not found for {old}")
    updated_files.append((path, next_text))

lock = root / "web/package-lock.json"
if lock.exists():
    import json

    data = json.loads(lock.read_text(encoding="utf-8"))
    changed = False
    if data.get("name") == "forkly-web" and data.get("version") == old:
        data["version"] = new
        changed = True
    pkg = data.get("packages", {}).get("")
    if isinstance(pkg, dict) and pkg.get("name") == "forkly-web" and pkg.get("version") == old:
        pkg["version"] = new
        changed = True
    if not changed:
        raise SystemExit(f"failed to update {lock}: version {old} not found")
    updated_files.append((lock, json.dumps(data, indent=2, ensure_ascii=False) + "\n"))

# Commit all writes only after every replacement succeeds.
(root / "VERSION").write_text(new + "\n", encoding="utf-8")
for path, text in updated_files:
    path.write_text(text, encoding="utf-8")

print(new)
PY
