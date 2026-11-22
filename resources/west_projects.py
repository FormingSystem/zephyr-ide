# SPDX-License-Identifier: Apache-2.0
"""Resolve the module picker using the workspace's installed west."""
import argparse
import configparser
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from west.manifest import ImportFlag, Manifest, ManifestImportFailed

MARK = "zephyr-ide-additional"


def manifests():
    direct = Manifest.from_file(import_flags=ImportFlag.IGNORE_PROJECTS)
    try:
        return direct, Manifest.from_file(), False
    except ManifestImportFailed:
        # A new workspace may not have cloned its importing project yet.
        return direct, direct, True


def catalog():
    direct, resolved, partial = manifests()
    root_names = {p.name for p in direct.projects[1:]}
    return {"partial": partial, "projects": [
        {"name": p.name, "url": p.url, "revision": p.revision, "path": p.path,
         "extra": isinstance(p.userdata, dict) and p.userdata.get(MARK) is True,
         "imported": p.name not in root_names}
        for p in resolved.projects[1:]
    ]}


def update(names, flags):
    if not names:
        raise ValueError("Select at least one project.")
    direct, resolved, _ = manifests()
    available = {p.name for p in resolved.projects[1:]}
    unknown = set(names) - available
    if unknown:
        raise ValueError("Unknown west projects: " + ", ".join(sorted(unknown)))
    cmd = [sys.executable, "-m", "west", "update", *flags, "--", *names]
    print(subprocess.list2cmdline(cmd[2:]), flush=True)
    direct_names = {p.name for p in direct.projects[1:]}
    if set(names) <= direct_names:
        return subprocess.call(cmd)
    # Named west updates accept only projects defined in the manifest repository.
    # Use the locally resolved definitions, including revisions, paths and submodules.
    # Override the local config for this child process only.
    root = Path(resolved.topdir)
    with tempfile.TemporaryDirectory(dir=root / ".west") as tmp:
        directory = Path(tmp)
        snapshot = directory / "west.yml"
        snapshot.write_text(resolved.as_yaml(), encoding="utf-8")
        config = configparser.ConfigParser(interpolation=None)
        source = os.environ.get("WEST_CONFIG_LOCAL") or root / ".west" / "config"
        with open(source, encoding="utf-8") as f:
            config.read_file(f)
        config["manifest"]["path"] = directory.relative_to(root).as_posix()
        config["manifest"]["file"] = snapshot.name
        local = directory / "config"
        with local.open("w", encoding="utf-8") as f:
            config.write(f)
        return subprocess.call(cmd, cwd=root, env={**os.environ, "WEST_CONFIG_LOCAL": str(local)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["list", "update"])
    parser.add_argument("--narrow", action="store_true")
    parser.add_argument("--keep-descendants", action="store_true")
    parser.add_argument("names", nargs="*")
    args = parser.parse_intermixed_args()
    try:
        if args.action == "list":
            print(json.dumps(catalog()))
        else:
            flags = [f for f, on in [("--narrow", args.narrow), ("--keep-descendants", args.keep_descendants)] if on]
            sys.exit(update(args.names, flags))
    except Exception as error:
        sys.exit(str(error))
