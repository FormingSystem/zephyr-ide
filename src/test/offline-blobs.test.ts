// SPDX-License-Identifier: Apache-2.0
import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import { summarizeBlobStatus } from "../setup_utilities/zephyr_ide_install";
import { copyVerifiedBlob } from "../setup_utilities/local-blob";

suite("Offline blobs", () => {
  test("all declared files must match before a module is marked fetched", () => {
    const listing = "radio\tA\tpart 1.bin\r\nradio\tM\tpart 2.bin\r\nusb\tA\tfw.bin\nnew\tD\tfw.bin\n";
    assert.deepStrictEqual(summarizeBlobStatus(listing).map(m => [m.moduleName, m.isFetched]),
      [["radio", false], ["usb", true], ["new", false]]);
  });

  test("failed offline import preserves the existing blob", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zide-blob-"));
    try {
      const source = path.join(dir, "incoming");
      const target = path.join(dir, "current");
      await fs.writeFile(source, "new");
      await fs.writeFile(target, "old");
      await assert.rejects(copyVerifiedBlob(source, target, "0".repeat(64)));
      assert.strictEqual(await fs.readFile(target, "utf8"), "old");
      await copyVerifiedBlob(source, target, createHash("sha256").update("new").digest("hex"));
      assert.strictEqual(await fs.readFile(target, "utf8"), "new");
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
