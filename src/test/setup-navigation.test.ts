import * as assert from "assert";
import * as vscode from "vscode";

function settingsTabs() {
  return vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("zephyrIDEConfiguration"));
}

async function openSidebarAndWaitForSettings() {
  await vscode.commands.executeCommand("workbench.view.extension.zephyr-ide-main");
  const deadline = Date.now() + 10000;
  while (!settingsTabs().some(tab => tab.isActive) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(settingsTabs().some(tab => tab.isActive), "Opening the Zephyr sidebar should reveal the IDE settings");
  assert.strictEqual(settingsTabs().length, 1);
}

suite("Zephyr sidebar navigation", () => {
  test("opens the IDE settings in an empty editor and reuses it on return", async () => {
    await vscode.commands.executeCommand("workbench.view.explorer");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    try {
      await openSidebarAndWaitForSettings();
      const originalTab = settingsTabs()[0];
      for (const command of ["open-setup-panel", "open-host-tools-panel", "open-sdk-panel",
        "open-workspace-panel", "select-west-modules", "open-runner-profile-panel", "open-settings-panel"]) {
        await vscode.commands.executeCommand("zephyr-ide." + command);
        assert.strictEqual(settingsTabs()[0], originalTab);
      }
      assert.strictEqual(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, 1);
      await vscode.commands.executeCommand("workbench.view.explorer");
      const document = await vscode.workspace.openTextDocument({ language: "plaintext" });
      await vscode.window.showTextDocument(document);
      await openSidebarAndWaitForSettings();
    } finally {
      await vscode.commands.executeCommand("workbench.view.explorer");
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });
});
