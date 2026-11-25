// SPDX-License-Identifier: Apache-2.0
import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { effectiveDefinitions } from "../zephyr_utilities/cmake-choices";
import { boardTargets } from "../zephyr_utilities/cmake-boards";
import { cmakeDefinitions, describeCMake } from "../zephyr_utilities/direct-cmake";

suite("Direct CMake configuration", () => {
  test("preserves path spaces, list separators and embedded equals in CMake arguments", () => {
    assert.deepStrictEqual(cmakeDefinitions("  BOARD = demo/cpu  \r\n\t\r\nEXTRA_CONF_FILE:STRING = a b.conf;c=d.conf\n"),
      ["-DBOARD=demo/cpu", "-DEXTRA_CONF_FILE:STRING=a b.conf;c=d.conf"]);
    assert.throws(() => cmakeDefinitions("BOARD demo"));
  });

  test("guided settings supplement user definitions without replacing typed or empty overrides", () => {
    const choices = { BOARD: "selected/cpu", ZEPHYR_BASE: "source tree" };
    const text = "CONF_FILE=one.conf;two.conf\r\n BOARD:STRING  =  user/cpu\r\nZEPHYR_BASE:PATH=";
    assert.strictEqual(effectiveDefinitions(text, choices), text);
    assert.deepStrictEqual(cmakeDefinitions(effectiveDefinitions("CONF_FILE=one.conf", choices)), [
      "-DCONF_FILE=one.conf", "-DBOARD=selected/cpu", "-DZEPHYR_BASE=source tree",
    ]);
  });

  test("keeps board revisions ahead of CPU qualifiers and deduplicates targets", () => {
    const output = [
      "NAME;board|QUALIFIERS;soc/app;soc/net|REVISIONS;1.0",
      "NAME;plain|QUALIFIERS;|REVISIONS;",
      "NAME;plain|QUALIFIERS;|REVISIONS;",
    ].join("\r\n");
    assert.deepStrictEqual(boardTargets(output), [
      "board/soc/app", "board/soc/net", "board@1.0/soc/app", "board@1.0/soc/net", "plain",
    ]);
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
