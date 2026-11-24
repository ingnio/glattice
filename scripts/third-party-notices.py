"""Regenerate THIRD-PARTY-NOTICES.md from the project's dependencies.

Run from the repository root:

    python scripts/third-party-notices.py

Needs cargo and pnpm on PATH. Lists the Rust crates compiled into the
default Windows build and the JavaScript packages bundled into the
interface, each with its declared license.
"""
import collections
import json
import shutil
import subprocess
import sys


def run(cmd, cwd=None):
    exe = shutil.which(cmd[0]) or cmd[0]
    return subprocess.run([exe, *cmd[1:]], cwd=cwd, check=True, capture_output=True, text=True, encoding="utf-8").stdout


def rust_rows():
    meta = json.loads(run(
        ["cargo", "metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc"],
        cwd="src-tauri",
    ))
    packages = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    root = meta["resolve"]["root"]
    seen, stack = set(), [root]
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        for dep in nodes[pid]["deps"]:
            # Normal dependencies only: build scripts and proc macros are
            # not part of the shipped binary.
            if any(kind["kind"] is None for kind in dep["dep_kinds"]):
                stack.append(dep["pkg"])
    seen.discard(root)
    rows = [
        (packages[i]["name"], packages[i]["version"], packages[i].get("license") or "see repository", packages[i].get("repository") or "")
        for i in seen
    ]
    return sorted(rows, key=lambda r: (r[0].lower(), r[1]))


def npm_rows():
    raw = json.loads(run(["pnpm", "licenses", "list", "--prod", "--json"]))
    rows = [
        (p["name"], ", ".join(p.get("versions", [])), lic, p.get("homepage") or "")
        for lic, pkgs in raw.items()
        for p in pkgs
    ]
    return sorted(rows, key=lambda r: (r[0].lower(), r[1]))


def main():
    rust, npm = rust_rows(), npm_rows()
    out = []
    w = out.append
    w("# Third-party notices\n")
    w(
        "Glattice is released under the MIT License (see `LICENSE`). It includes or links the\n"
        "third-party components listed below, each under its own license. This file is generated\n"
        "by `scripts/third-party-notices.py`; regenerate it when dependencies change.\n"
    )
    w("## Font\n")
    w(
        "- **Roboto Mono** (`src-tauri/assets/RobotoMono-Regular.ttf`). Copyright 2015 The Roboto Mono "
        "Project Authors (https://github.com/googlefonts/robotomono). Licensed under the SIL Open Font "
        "License, Version 1.1. The full license text is in `src-tauri/assets/OFL.txt`.\n"
    )
    w("## Optional component\n")
    w(
        "- **gifski** is linked only when Glattice is built with `--features gifski`. It is licensed under "
        "AGPL-3.0, and a binary built that way is subject to the AGPL. Default builds and the official "
        "installers do not include it.\n"
    )

    def table(title, rows):
        w(f"## {title} ({len(rows)})\n")
        w("| Package | Version | License | Source |")
        w("| --- | --- | --- | --- |")
        for name, version, lic, url in rows:
            w(f"| {name} | {version} | {lic} | {url} |")
        w("")

    table("Rust crates compiled into the application", rust)
    table("JavaScript packages bundled into the interface", npm)

    w("## License summary\n")
    counts = collections.Counter([r[2] for r in rust] + [r[2] for r in npm])
    for lic, n in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        w(f"- {lic}: {n}")
    w("")

    with open("THIRD-PARTY-NOTICES.md", "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))
    print(f"{len(rust)} crates, {len(npm)} npm packages", file=sys.stderr)


if __name__ == "__main__":
    main()
