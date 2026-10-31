#!/usr/bin/env python3
"""Offline, dependency-free validation of the Owli Avatar repository foundation."""

import ast
import json
from pathlib import Path
import sys
import tomllib


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "README.md",
    "AGENTS.md",
    ".codex/config.toml",
    ".codex/agents/explorer.toml",
    ".codex/agents/researcher.toml",
    ".codex/agents/builder.toml",
    ".codex/agents/reviewer.toml",
    "docs/roadmap.md",
    "docs/architecture.md",
    "docs/contracts.md",
    "docs/assets.md",
    "docs/ki-server.md",
    "docs/codex-workflow.md",
    "apps/api/pyproject.toml",
    "apps/api/src/owli_avatar/main.py",
    "apps/api/tests/test_mock_api.py",
    "apps/web/package.json",
    "apps/web/index.html",
    "apps/web/src/main.ts",
    ".github/workflows/ci.yml",
    "scripts/bootstrap.sh",
    "scripts/run-dev.sh",
    "scripts/check.sh",
]


def check() -> list[str]:
    errors: list[str] = []
    for path in REQUIRED:
        if not (ROOT / path).is_file():
            errors.append(f"missing required file: {path}")
    if errors:
        return errors

    with (ROOT / ".codex/config.toml").open("rb") as handle:
        config = tomllib.load(handle)
    if config.get("model") != "gpt-6.1-terra":
        errors.append("coordinator model is not gpt-6.1-terra")
    if config.get("model_reasoning_effort") != "medium":
        errors.append("coordinator effort is not medium")
    agents = config.get("agents", {})
    if agents.get("default_subagent_model") != "gpt-6-luna":
        errors.append("default subagent is not gpt-6-luna")
    if agents.get("max_concurrent_threads_per_session") != 2:
        errors.append("max_concurrent_threads_per_session must equal 2")
    for name in ("explorer", "researcher", "builder", "reviewer"):
        with (ROOT / f".codex/agents/{name}.toml").open("rb") as handle:
            role = tomllib.load(handle)
        if role.get("name") != name:
            errors.append(f"role name mismatch: {name}")
        if role.get("model") != "gpt-6-luna":
            errors.append(f"role model mismatch: {name}")
        if not role.get("developer_instructions"):
            errors.append(f"missing instructions: {name}")

    with (ROOT / "apps/api/pyproject.toml").open("rb") as handle:
        project = tomllib.load(handle)
    if project.get("project", {}).get("name") != "owli-avatar-api":
        errors.append("invalid API project metadata")

    with (ROOT / "apps/web/package.json").open(encoding="utf-8") as handle:
        web = json.load(handle)
    if web.get("name") != "owli-avatar-web":
        errors.append("invalid web project metadata")
    if "three" not in web.get("dependencies", {}):
        errors.append("Three.js dependency is missing")
    for file in (
        "scripts/check_foundation.py",
        "apps/api/src/owli_avatar/main.py",
        "apps/api/tests/test_mock_api.py",
    ):
        ast.parse((ROOT / file).read_text(encoding="utf-8"), filename=file)

    print("Foundation: present files, TOML, JSON and Python syntax inspected.")
    print("Not checked: npm build, API runtime, browser rendering, live LLM/TTS/STT, assets.")
    return errors


if __name__ == "__main__":
    problems = check()
    if problems:
        for problem in problems:
            print("ERROR:", problem, file=sys.stderr)
        raise SystemExit(1)
    print("Foundation check: OK")

