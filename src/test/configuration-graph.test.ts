// SPDX-License-Identifier: Apache-2.0
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileDraft } from "../panels/project_build_view/configuration-graph/draft";
import {
  confEntries,
  renderChanges,
  validateValue,
  type Change,
} from "../panels/project_build_view/configuration-graph/documents";
import type { GraphOption } from "../panels/project_build_view/configuration-graph/types";

function symbol(id: string): GraphOption {
  return { id, label: id, type: "bool", group: "Drivers", value: "y", choices: ["y", "n"] };
}
suite("Visual configuration drafts", () => {
  test("changes only named assignments and preserves comments, CRLF and blank lines", () => {
    const original = '# Before\r\n\r\n  CONFIG_FOO = y\r\n# CONFIG_BAR is not set\r\nCONFIG_OTHER="abc"\r\n';
    const changes = [
      { option: symbol("CONFIG_FOO"), value: "n" },
      { option: symbol("CONFIG_BAR"), value: null },
      { option: symbol("CONFIG_NEW"), value: "y" },
    ];
    const updated = renderChanges(original, "kconfig", changes);
    assert.strictEqual(updated, '# Before\r\n\r\nCONFIG_FOO=n\r\nCONFIG_OTHER="abc"\r\nCONFIG_NEW=y\r\n');
    assert.strictEqual(confEntries(original).get("CONFIG_BAR"), "n");
    assert.strictEqual(confEntries(updated).has("CONFIG_BAR"), false);
    assert.strictEqual(renderChanges(original, "kconfig", []), original);
  });
  test("reuses a path override and retains hand-written overlay statements", () => {
    const opt = { id: "/bus:status", label: "status", group: "/bus", type: "string", value: "okay" };
    const original = '&uart { status = "okay"; };\n';
    const first = renderChanges(original, "device", [{ option: opt, value: "disabled" }]);
    const again = renderChanges(first, "device", [{ option: opt, value: "okay" }]);
    assert.ok(again.startsWith(original));
    assert.strictEqual(again.split("&{/bus}").length, 2);
    assert.ok(again.includes('&{/bus} { status = "okay"; };'));
  });
  test("keeps other presets and separates build directories for distinct boards", () => {
    const original = '{"version":3, "configurePresets":[{"name":"existing","generator":"Ninja","binaryDir":"custom"}]}';
    const selected = (v: string): Change[] => [{ option: symbol("BOARD"), value: v }];
    const before = renderChanges(original, "board", selected("board/cpu1"));
    const after = JSON.parse(renderChanges(before, "board", selected("board/cpu2")));
    assert.deepStrictEqual(after.configurePresets[0], JSON.parse(original).configurePresets[0]);
    assert.strictEqual(after.configurePresets.length, 2);
    assert.strictEqual(after.configurePresets[1].cacheVariables.BOARD, "board/cpu2");
    assert.ok(after.configurePresets[1].binaryDir.endsWith("board-cpu2"));
  });
  test("rejects multi-line values and invalid device cells", () => {
    assert.ok(!validateValue(symbol("CONFIG_X"), "y\nCONFIG_B=y"));
    const cell = { ...symbol("speed"), type: "cell", choices: undefined };
    assert.ok(validateValue(cell, "0xffffffff"));
    assert.ok(!validateValue(cell, "4294967296"));
  });
  test("an isolated draft refuses to overwrite a concurrent edit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-graph-"));
    try {
      const file = path.join(root, "prj.conf");
      const original = "\uFEFFCONFIG_X=y\r\n";
      fs.writeFileSync(file, original);
      const draft = new FileDraft(root, "prj.conf", "kconfig");
      draft.stage(symbol("CONFIG_X"), "n");
      assert.strictEqual(fs.readFileSync(file, "utf8"), original);
      assert.strictEqual(draft.view.after, "\uFEFFCONFIG_X=n\r\n");
      fs.appendFileSync(file, "# external\r\n");
      assert.throws(() => draft.save());
      assert.strictEqual(fs.readFileSync(file, "utf8"), original + "# external\r\n");
      assert.deepStrictEqual(draft.view.keys, ["CONFIG_X"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test("preparing a new file never creates it or writes outside the application", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-graph-"));
    try {
      const draft = new FileDraft(root, "extra.conf", "kconfig");
      draft.stage(symbol("CONFIG_X"), "y");
      assert.ok(!fs.existsSync(path.join(root, "extra.conf")));
      assert.throws(() => new FileDraft(root, "../outside.conf", "kconfig"));
      assert.ok(draft.save());
      assert.strictEqual(fs.readFileSync(path.join(root, "extra.conf"), "utf8"), "CONFIG_X=y\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
