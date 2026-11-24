// SPDX-License-Identifier: Apache-2.0
import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { importSDKArchive } from "../setup_utilities/west_sdk";

suite("Offline SDK bundles", () => {
  test("imports a local SDK bundle once and rejects a mismatched digest", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zide-sdk-"));
    const parent = path.join(dir, "installed");
    const root = "zephyr-sdk-1.2.3";
    const archive = path.join(dir, "bundle.tar");
    try {
      await fs.mkdir(path.join(dir, root));
      await fs.writeFile(path.join(dir, root, "sdk_version"), "1.2.3\n");
      execFileSync("tar", ["-cf", archive, "-C", dir, root]);
      const digest = createHash("sha256").update(await fs.readFile(archive)).digest("hex");
      await assert.rejects(importSDKArchive(archive, false, "0".repeat(64), parent));
      assert.deepStrictEqual(await fs.readdir(parent), []);
      await importSDKArchive(archive, false, digest, parent);
      await assert.rejects(importSDKArchive(archive, false, digest, parent));
      assert.deepStrictEqual(await fs.readdir(parent), [root]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
