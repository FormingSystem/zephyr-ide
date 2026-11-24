// SPDX-License-Identifier: Apache-2.0
import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import { panelText } from "../../webview_shared/panel-text";
import type { ProjectBuildPanelData } from "../project-build-data";

@customElement("cmake-section")
export class CMakeSection extends ZephyrLitElement {
  @property({ attribute: false }) data!: ProjectBuildPanelData["cmake"];
  @property({ type: Boolean }) busy = false;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.onBoard);
  }

  disconnectedCallback() {
    window.removeEventListener("message", this.onBoard);
    super.disconnectedCallback();
  }

  private onBoard = (event: MessageEvent) => {
    const { command, binary, board } = event.data;
    const input = this.querySelector("textarea");
    if (command !== "cmakeBoard" || binary !== this.data.binary || !input) { return; }
    const lines = input.value.split(/\r?\n/).filter(line => !/^\s*BOARD(?::STRING)?\s*=/.test(line));
    input.value = ["BOARD=" + board, ...lines].join("\n").trimEnd();
    this.querySelector("details")?.setAttribute("open", "");
  };

  private action(action: string) {
    const definitions = this.querySelector("textarea")?.value ?? "";
    this.postCommand("directCMake", { action, definitions, binary: this.data.binary });
  }

  private button(action: string, label: string, enabled = true) {
    return html`<vscode-button ?secondary=${action !== (this.data.configured ? "build" : "configure")}
      ?disabled=${!enabled || this.busy} @click=${() => this.action(action)}>${label}</vscode-button>`;
  }

  render() {
    const d = this.data;
    const row = (label: string, value: string, action: string) => html`<div class="cmake-location">
      <strong>${label}</strong><code>${value || "—"}</code>${this.button(action, panelText("Browse"))}</div>`;
    return html`<section class="cmake-section">
      ${row(panelText("Application (-S)"), d.source, "source")}
      ${row(panelText("Build directory (-B)"), d.binary, "binary")}
      <details ?open=${!d.configured}><summary>${panelText("Configure board, modules and drivers (-D)")}</summary>
        ${this.button("board", panelText("Select board and CPU target"))}
        <label>${panelText("One NAME=value per line. BOARD selects the board and CPU target; CONF_FILE and DTC_OVERLAY_FILE select application configuration and hardware.")}
          <textarea rows="4" placeholder="BOARD=…&#10;CONF_FILE=prj.conf" .defaultValue=${d.defaults}></textarea></label>
      </details>
      <div class="page-actions">
        ${this.button("configure", panelText("Configure"), !!d.source)}
        ${this.button("build", panelText("Build"), d.configured)}
        ${this.button("menuconfig", "Kconfig · menuconfig", d.configured)}
        ${this.button("target", panelText("Build targets (flash / debug…)"), d.configured)}
        ${this.button("launch", "VS Code · launch.json")}
      </div>
      ${d.variables.length ? html`<details><summary>${panelText("Resolved Zephyr variables")}</summary>
        <dl>${d.variables.map(v => html`<dt><code>${v.name}</code></dt><dd>${v.value} · ${v.origin}</dd>`)}</dl>
      </details>` : nothing}
    </section>`;
  }
}
