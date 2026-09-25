"""Validate the self-contained Codex marketplace using only Python stdlib."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def check(condition, message):
    if not condition:
        raise SystemExit(message)

def inside(path):
    check(not path.is_symlink(), f"Symlink is not allowed: {path}")
    check(path.resolve().is_relative_to(ROOT), f"Path escapes marketplace: {path}")
    return path

catalog = json.loads((ROOT / ".agents/plugins/marketplace.json").read_text())
check(catalog["name"] == "cododel", "Unexpected marketplace name")
seen = set()
for entry in catalog["plugins"]:
    name = entry["name"]
    check(name not in seen, f"Duplicate plugin: {name}")
    seen.add(name)
    check(entry["source"]["source"] == "local", "Expected self-contained local source")
    check(entry["source"]["path"] == f"./plugins/{name}", "Unexpected plugin path")
    plugin = inside(ROOT / entry["source"]["path"])
    manifest = json.loads((plugin / ".codex-plugin/plugin.json").read_text())
    check(manifest["name"] == name, "Manifest name mismatch")
    check(manifest["version"].startswith("0.1."), "Expected 0.1.* version")
    check(manifest["mcpServers"] == "./.mcp.json", "Unexpected MCP config path")
    mcp = json.loads((plugin / ".mcp.json").read_text())
    server = mcp["mcpServers"]["blueprint"]
    check(server == {"command": "${PLUGIN_ROOT}/bin/blueprint", "args": ["mcp"]}, "Unexpected MCP launcher")
    check((plugin / "skills/blueprint/SKILL.md").is_file(), "Missing Blueprint skill")
    binary = inside(plugin / "bin/blueprint")
    check(binary.is_file() and os.access(binary, os.X_OK), "Missing executable or executable permissions")
    check(binary.stat().st_size < 100 * 1024 * 1024, "Binary exceeds GitHub file limit")
    check(entry["policy"] == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "Unexpected installation policy")

expected = json.loads((ROOT / "checksums.json").read_text())
actual = {}
for path in sorted((ROOT / "plugins").rglob("*")):
    inside(path)
    if path.is_file():
        actual[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
check(actual == expected, "Package files differ from checksums.json")
check(bool(seen) and bool(actual), "Empty marketplace")
print(f"Validated {len(seen)} plugin(s), {len(actual)} package files")
