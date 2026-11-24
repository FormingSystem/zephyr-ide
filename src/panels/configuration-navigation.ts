import { l10n } from "vscode";
import { escapeHtml } from "./webview_shared/webviewTypes";

const pages = {
  project: ["Project Details", "zephyr-ide.open-project-build-panel"],
  manager: ["Project requirements", "zephyr-ide.open-zephyr-ide-manager"],
  settings: ["Settings", "zephyr-ide.open-settings-panel"],
  overview: ["Overview", "zephyr-ide.open-setup-panel"],
  tools: ["Host Tools", "zephyr-ide.open-host-tools-panel"],
  sdk: ["Zephyr SDK", "zephyr-ide.open-sdk-panel"],
  workspace: ["Workspace Setup", "zephyr-ide.open-workspace-panel"],
  modules: ["West Git modules", "zephyr-ide.select-west-modules"],
  runners: ["Runner Profiles", "zephyr-ide.open-runner-profile-panel"],
} as const;

export const configurationCommands = Object.values(pages).map(([, command]) => command);

type Page = keyof typeof pages;

const sections: { label: string; pages: Page[] }[] = [
  { label: "Project configuration", pages: ["project", "workspace", "modules", "runners", "overview"] },
  { label: "Tool environment", pages: ["tools", "sdk", "manager"] },
  { label: "Extension settings", pages: ["settings"] },
];

export function configurationNavigation(current: Page): string {
  const section = sections.find(group => group.pages.includes(current))!;
  const link = (page: Page, label: string, active: boolean) =>
    `<a href="command:${pages[page][1]}"${active ? ' aria-current="page"' : ""}>${escapeHtml(l10n.t(label))}</a>`;
  const groups = sections.map(group => link(group.pages[0], group.label, group === section));
  const items = section.pages.map(page => link(page, pages[page][0], page === current));
  return `<header class="workbench-navigation">
    <nav class="configuration-navigation" aria-label="${escapeHtml(l10n.t("Zephyr IDE"))}">${groups.join("")}</nav>
    ${items.length > 1 ? `<nav class="configuration-navigation workbench-tools" aria-label="${escapeHtml(l10n.t(section.label))}">${items.join("")}</nav>` : ""}
  </header>`;
}
