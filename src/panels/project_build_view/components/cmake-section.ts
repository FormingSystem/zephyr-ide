// SPDX-License-Identifier: Apache-2.0
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import { panelText } from "../../webview_shared/panel-text";
import { explicitChoice, guidedKeys, type CMakeChoices, type GuidedKey } from "../../../zephyr_utilities/cmake-choices";
import { fuzzyMatcher } from "../../webview_shared/module-search";
import type { ProjectBuildPanelData } from "../project-build-data";

@customElement("cmake-section")
export class CMakeSection extends ZephyrLitElement {
  @property({ attribute: false }) data!: ProjectBuildPanelData["cmake"];
  @property({ type: Boolean }) busy = false;

  @state() private pickerFor = "";
  @state() private boards?: string[];
  @state() private search = "";
  @state() private scanError = "";

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.onBoard);
  }

  disconnectedCallback() {
    window.removeEventListener("message", this.onBoard);
    super.disconnectedCallback();
  }

  private requestId = "";

  private onBoard = (event: MessageEvent) => {
    const { command, binary, source, boards, error, chosenBase } = event.data;
    if (command !== "cmakeBoards" || event.data.requestId !== this.requestId || binary !== this.data.binary || source !== this.data.source || this.pickerFor !== this.draftKey) { return; }
    if (chosenBase !== undefined) {
      if (chosenBase) {
        this.setChoice("ZEPHYR_BASE", chosenBase);
        this.scanBoards();
      }
      return;
    }
    this.boards = boards ?? [];
    this.scanError = error ?? "";
  };

  private get choices(): CMakeChoices {
    return this.readState<CMakeChoices>(this.draftKey + ":choices") ?? this.data.choices ?? {};
  }

  private setChoice(key: GuidedKey, value: string) {
    this.saveState(this.draftKey + ":choices", { ...this.choices, [key]: value });
    this.requestUpdate();
  }

  private choiceSummary(key: GuidedKey) {
    const selected = this.choices[key];
    if (!selected) { return nothing; }
    const manual = explicitChoice(this.definitions, key);
    return html`<span class="cmake-choice">
      <code>${key}=${selected}</code>
      <button type="button" aria-label=${panelText("Clear selection: {0}", key)} title=${panelText("Clear selection: {0}", key)}
        @click=${() => this.setChoice(key, "")}><span class="codicon codicon-close" aria-hidden="true"></span></button>
      ${manual !== undefined && manual !== selected ? html`<small>${panelText("Using your definition: {0}", key + "=" + manual)}</small>` : nothing}
    </span>`;
  }

  private scanBoards() {
    this.pickerFor = this.draftKey;
    this.boards = undefined;
    this.scanError = "";
    this.search = "";
    this.requestId = crypto.randomUUID();
    this.action("board");
    void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".board-picker input")?.focus());
  }

  private chooseBoard(board?: string) {
    if (!board) { return; }
    this.setChoice("BOARD", board);
    this.closePicker();
  }

  private closePicker() {
    this.pickerFor = "";
    void this.updateComplete.then(() => this.querySelector<HTMLButtonElement>(".choose-board")?.focus());
  }

  private matchingBoards() {
    const query = this.search.trim().toLowerCase();
    if (!query) { return this.boards ?? []; }
    const matches = this.boards?.filter(fuzzyMatcher(query)) ?? [];
    // Prefer a contiguous match before accepting a looser subsequence on Enter.
    return matches.sort((a, b) => Number(b.toLowerCase().includes(query)) - Number(a.toLowerCase().includes(query)));
  }

  private boardPicker() {
    const label = panelText("Select board and CPU target");
    const open = this.pickerFor === this.draftKey;
    const targets = this.matchingBoards();
    return html`<div class="cmake-board-control"><vscode-button class="choose-board" secondary ?disabled=${this.busy} aria-expanded=${open}
      @click=${() => open ? this.pickerFor = "" : this.scanBoards()}>${label}</vscode-button>
        ${guidedKeys.map(key => this.choiceSummary(key))}</div>
      ${open ? html`<div class="board-picker" @keydown=${(e: KeyboardEvent) => { if (e.key === "Escape") { this.closePicker(); } }}>
        <input type="search" aria-label=${label} placeholder=${panelText("Search board or CPU")} .value=${this.search}
          @input=${(e: Event) => { this.search = (e.target as HTMLInputElement).value; }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") { this.chooseBoard(targets[0]); }
            if (e.key === "ArrowDown") { e.preventDefault(); this.querySelector("select")?.focus(); }
          }}>
        ${targets.length ? html`<select size=${Math.max(2, Math.min(6, targets.length))} aria-label=${label}
          @click=${(e: Event) => this.chooseBoard((e.currentTarget as HTMLSelectElement).value)}
          @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") { this.chooseBoard((e.currentTarget as HTMLSelectElement).value); } }}>
          ${targets.map(target => html`<option>${target}</option>`)}
        </select>` : html`<div role="status">${this.scanError || (this.boards ? panelText("No matching targets") : panelText("Scanning local boards…"))}</div>`}
        ${this.boards?.length === 0 ? this.button("boardSource", panelText("Choose Zephyr source directory")) : nothing}
      </div>` : nothing}`;
  }

  private get draftKey() {
    return "cmakeDraft:" + JSON.stringify([this.data.source, this.data.binary]);
  }

  private get definitions() {
    const draft = this.readState<{ base: string; value: string }>(this.draftKey);
    return draft?.base === this.data.defaults ? draft.value : this.data.defaults;
  }

  private rememberDefinitions(value: string) {
    this.saveState(this.draftKey, { base: this.data.defaults, value });
    this.requestUpdate();
  }

  private action(action: string) {
    const definitions = this.querySelector("textarea")?.value ?? "";
    this.postCommand("directCMake", { action, definitions, board: this.choices.BOARD ?? "", zephyrBase: this.choices.ZEPHYR_BASE ?? "", requestId: this.requestId, binary: this.data.binary });
  }

  private button(action: string, label: string, enabled = true, accessibleName = label) {
    return html`<vscode-button ?secondary=${action !== (this.data.configured ? "build" : "configure")}
      aria-label=${accessibleName} ?disabled=${!enabled || this.busy} @click=${() => this.action(action)}>${label}</vscode-button>`;
  }

  render() {
    const d = this.data;
    const row = (label: string, fullPath: string, displayPath: string, action: string) => html`<div class="cmake-location">
      <strong>${label}</strong><code title=${fullPath}>${displayPath || "—"}</code>
      ${this.button(action, panelText("Browse"), true, panelText("Browse: {0}", label))}
    </div>`;
    return html`<section class="cmake-section">
      ${row(panelText("Application (-S)"), d.source, d.sourceLabel, "source")}
      ${row(panelText("Build directory (-B)"), d.binary, d.binaryLabel, "binary")}
      ${d.hasApplication ? nothing : html`<p class="cmake-hint" role="status">${panelText("Choose an application directory containing CMakeLists.txt to enable Configure.")}</p>`}
      <details ?open=${!d.configured}><summary>${panelText("Configure board, modules and drivers (-D)")}</summary>
        ${this.boardPicker()}
        <label title=${panelText("One NAME=value per line. BOARD selects the board and CPU target; CONF_FILE and DTC_OVERLAY_FILE select application configuration and hardware.")}>${panelText("CMake definitions (-D)")}
          <textarea rows="4" placeholder="BOARD=…&#10;CONF_FILE=prj.conf" .defaultValue=${this.definitions}
            @input=${(event: Event) => this.rememberDefinitions((event.currentTarget as HTMLTextAreaElement).value)}></textarea></label>
      </details>
      <div class="page-actions">
        ${this.button("configure", panelText("Configure"), d.hasApplication)}
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
