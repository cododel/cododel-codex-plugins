"""Package the built macOS arm64 plugin and test the extracted deliverable."""
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "dist/blueprint-plugin"
ARCHIVE = ROOT / "dist/blueprint-plugin-macos-arm64.zip"

if platform.system() != "Darwin" or platform.machine() != "arm64":
    raise SystemExit("This package target requires native macOS arm64")
manifest = json.loads((SOURCE / ".codex-plugin/plugin.json").read_text())
package = json.loads((ROOT / "package.json").read_text())
if manifest["name"] != package["name"] or manifest["version"] != package["version"]:
    raise SystemExit("Plugin and package names/versions must match")

# Keep the manifest at the ZIP root and preserve Unix executable permissions.
entries = [".codex-plugin", ".mcp.json", "bin", "skills", "README.md", "VALIDATION.md"]
with ZipFile(ARCHIVE, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for entry in entries:
        path = SOURCE / entry
        if not path.exists():
            raise SystemExit(f"Missing package entry: {entry}; run bun run build")
        for file in sorted(path.rglob("*")) if path.is_dir() else [path]:
            if file.is_symlink():
                raise SystemExit(f"Symlink not allowed in package: {file}")
            if file.is_file():
                archive.write(file, file.relative_to(SOURCE).as_posix())

with ZipFile(ARCHIVE) as archive:
    if archive.testzip() is not None:
        raise SystemExit("ZIP integrity check failed")
    for required in [".codex-plugin/plugin.json", ".mcp.json", "bin/blueprint", "skills/blueprint/SKILL.md"]:
        archive.getinfo(required)
    if not (archive.getinfo("bin/blueprint").external_attr >> 16) & stat.S_IXUSR:
        raise SystemExit("Executable permission missing from ZIP")

# Use the OS extractor, so the smoke test also checks stored Unix permissions.
(ROOT / ".tmp").mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="package-check-", dir=ROOT / ".tmp") as temp:
    subprocess.run(["/usr/bin/unzip", "-q", str(ARCHIVE), "-d", temp], check=True)
    subprocess.run(
        ["bun", "scripts/packaged-check.ts"], cwd=ROOT, check=True,
        env={**os.environ, "BLUEPRINT_BINARY": str(Path(temp) / "bin/blueprint")},
    )

hasher = hashlib.sha256()
with ARCHIVE.open("rb") as file:
    for chunk in iter(lambda: file.read(1024 * 1024), b""):
        hasher.update(chunk)
digest = hasher.hexdigest()
ARCHIVE.with_suffix(".zip.sha256").write_text(f"{digest}  {ARCHIVE.name}\n")
report = f"{ARCHIVE.name}: {ARCHIVE.stat().st_size:,} bytes\nSHA256: {digest}\n"
print(report)
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f"### Blueprint {manifest['version']} — macOS arm64\n\n```text\n{report}```\n")
