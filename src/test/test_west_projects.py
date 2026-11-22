# SPDX-License-Identifier: Apache-2.0
"""Offline west module picker regression cases. Run with the workspace's west Python."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml

HELPER = Path(__file__).resolve().parents[2] / "resources" / "west_projects.py"


def run(cwd, *cmd, data=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True,
                          input=json.dumps(data) if data is not None else None)


def repository(root, name, files):
    repo = root / name
    repo.mkdir()
    run(repo, "git", "init", "-q")
    for filename, content in files.items():
        (repo / filename).write_text(content, encoding="utf-8")
    run(repo, "git", "add", ".")
    run(repo, "git", "-c", "user.name=Test", "-c", "user.email=test@example.org",
        "commit", "-qm", "Add test fixture")
    return {"name": name, "url": repo.as_uri(),
            "revision": run(repo, "git", "rev-parse", "HEAD").stdout.strip()}


class WestProjectsTest(unittest.TestCase):
    def test_selects_only_named_repositories_including_project_imports(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            selected = repository(root, "hal_example", {"VERSION": "1"})
            unused = repository(root, "hal_unused", {"VERSION": "2"})
            provider = repository(root, "provider", {"west.yml": yaml.safe_dump(
                {"manifest": {"projects": [selected, unused]}})})
            provider["import"] = True
            workspace = root / "workspace"
            manifest = workspace / "manifest"
            manifest.mkdir(parents=True)
            (manifest / "west.yml").write_text(yaml.safe_dump({"manifest": {"projects": [provider]}}))
            run(workspace, sys.executable, "-m", "west", "init", "-l", str(manifest))
            config = workspace / ".west" / "config"
            original = config.read_bytes()

            def helper(*args, check=True):
                result = run(workspace, sys.executable, str(HELPER), *args, check=False)
                if check:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result
            self.assertTrue(json.loads(helper("list").stdout)["partial"])
            self.assertNotEqual(helper("update", check=False).returncode, 0)
            self.assertFalse((workspace / "provider").exists())
            helper("update", "--", "provider")
            self.assertFalse((workspace / "hal_example").exists())
            catalog = json.loads(helper("list").stdout)
            self.assertFalse(catalog["partial"])
            self.assertEqual({p["name"] for p in catalog["projects"] if p["imported"]}, {"hal_example", "hal_unused"})
            helper("update", "--narrow", "--", "hal_example")
            self.assertEqual(run(workspace / "hal_example", "git", "rev-parse", "HEAD").stdout.strip(), selected["revision"])
            self.assertFalse((workspace / "hal_unused").exists())
            self.assertEqual(config.read_bytes(), original)

if __name__ == "__main__":
    unittest.main()
