import { l10n } from "vscode";
import { escapeHtml } from "./webview_shared/webviewTypes";

const pages = {
  settings: ["Settings", "zephyr-ide.open-settings-panel"],
  overview: ["Overview", "zephyr-ide.open-setup-panel"],
  tools: ["Host Tools", "zephyr-ide.open-host-tools-panel"],
  sdk: ["Zephyr SDK", "zephyr-ide.open-sdk-panel"],
  workspace: ["Workspace Setup", "zephyr-ide.open-workspace-panel"],
  modules: ["West Git modules", "zephyr-ide.select-west-modules"],
  runners: ["Runner Profiles", "zephyr-ide.open-runner-profile-panel"],
} as const;

export const configurationCommands = Object.values(pages).map(([, command]) => command);

export function configurationNavigation(current: keyof typeof pages): string {
  const links = Object.entries(pages).map(([id, [label, command]]) => {
    const active = id === current ? ' aria-current="page"' : "";
    return `<a href="command:${command}"${active}>${escapeHtml(l10n.t(label))}</a>`;
  });
  return `<nav class="configuration-navigation" aria-label="${escapeHtml(l10n.t("Setup & Configuration"))}">${links.join("")}</nav>`;
}
