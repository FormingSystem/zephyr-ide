// SPDX-License-Identifier: Apache-2.0
import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { cmakeDefinitions, describeCMake } from "../zephyr_utilities/direct-cmake";

suite("Direct CMake configuration", () => {
  test("preserves path spaces, list separators and embedded equals in CMake arguments", () => {
    assert.deepStrictEqual(cmakeDefinitions("  BOARD = demo/cpu  \r\n\t\r\nEXTRA_CONF_FILE:STRING = a b.conf;c=d.conf\n"),
      ["-DBOARD=demo/cpu", "-DEXTRA_CONF_FILE:STRING=a b.conf;c=d.conf"]);
    assert.throws(() => cmakeDefinitions("BOARD demo"));
  });

  test("a build directory belongs to its cached application", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zide-cache-"));
    try {
      assert.strictEqual(describeCMake({ source: dir, binary: dir }).hasApplication, false);
      await fs.writeFile(path.join(dir, "CMakeLists.txt"), "project(test)");
      assert.strictEqual(describeCMake({ source: dir, binary: dir }).hasApplication, true);
      await fs.writeFile(path.join(dir, "CMakeCache.txt"), "CMAKE_HOME_DIRECTORY:INTERNAL=" + dir + "\n");
      assert.strictEqual(describeCMake({ source: dir, binary: dir }).configured, false);
      await fs.mkdir(path.join(dir, "CMakeFiles"));
      await fs.writeFile(path.join(dir, "CMakeFiles", "TargetDirectories.txt"), "app");
      assert.strictEqual(describeCMake({ source: dir, binary: dir }).configured, true);
      assert.strictEqual(describeCMake({ source: path.join(dir, "other"), binary: dir }).configured, false);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
