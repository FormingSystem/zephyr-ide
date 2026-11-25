// SPDX-License-Identifier: Apache-2.0
import type { CMakeSection } from "./cmake-section";
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import { panelText as t } from "../../webview_shared/panel-text";
import { fuzzyMatcher } from "../../webview_shared/module-search";
import { routes, type Catalog, type DraftView, type GraphOption, type Route } from "../configuration-graph/types";

const titles = { board: "Board and CPU", kconfig: "Kconfig", device: "Devicetree" };
const icons = { board: "circuit-board", kconfig: "settings-gear", device: "type-hierarchy" };
const pageSize = 5;

@customElement("configuration-map")
export class ConfigurationMap extends ZephyrLitElement {
  @property({ type: Boolean, reflect: true }) expanded = false;
  @state() private zoom = 100;
  private initialSelection?: string;
  @state() private presetBoard = "";

  protected firstUpdated() {
    const data = document.getElementById("cg-position")?.textContent;
    if (this.expanded && data) {
      const position = JSON.parse(data);
      this.source = position.source;
      this.binary = position.binary;
      this.restorePosition({ ...position, ...this.readState<object>("graphPosition") });
    }
  }
  private restorePosition(p: {
    route: Route;
    file?: string;
    query?: string;
    selected?: string;
    zoom?: number;
    page?: number;
  }) {
    this.zoom = p.zoom ?? this.zoom;
    this.page = p.page ?? 0;
    this.open = true;
    this.route = p.route;
    this.query = p.query || "";
    this.initialSelection = p.selected;
    this.send("open", p.file || "");
  }
  protected updated() {
    if (this.expanded && this.draft && !this.busy) {
      this.saveState("graphPosition", {
        route: this.route,
        file: this.draft.file,
        query: this.query,
        selected: this.selected?.id,
        page: this.page,
        zoom: this.zoom,
      });
    }
  }
  private openEditor(newWindow: boolean) {
    if (this.expanded) {
      this.vscodeApi.postMessage({ command: "graphNewWindow" });
      return;
    }
    this.vscodeApi.postMessage({
      command: "openGraphEditor",
      method: this.method,
      source: this.source,
      binary: this.binary,
      definitions: this.manualDefinitions,
      route: this.route,
      file: this.draft?.file,
      query: this.query,
      id: this.selected?.id,
      newWindow,
    });
  }
  private get manualDefinitions() {
    return (
      this.parentElement?.querySelector<CMakeSection>("cmake-section")?.configurationDefinitions ?? this.definitions
    );
  }
  @property() method = "CMake";
  @property() source = "";
  @property() binary = "";
  @property() definitions = "";
  @state() private open = false;
  @state() private chooseRoute = false;
  @state() private route: Route = "kconfig";
  @state() private catalog?: Catalog;
  @state() private draft?: DraftView;
  @state() private query = "";
  @state() private page = 0;
  @state() private selected?: GraphOption;
  @state() private value = "";
  @state() private status = "";
  @state() private busy = false;
  @state() private entries: Record<string, string> = {};
  @state() private staged: Record<string, string | null> = {};
  @state() private pending: string[] = [];
  private request = "";
  private drag?: { x: number; y: number; left: number; top: number };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.receive);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.receive);
  }

  private receive = (event: MessageEvent) => {
    const m = event.data;
    if (m.command === "graphPosition" && this.expanded) {
      if (!this.busy) {
        this.restorePosition(m);
      }
      return;
    }
    const shared =
      m.command === "graphDraftChanged" &&
      m.source === this.source &&
      m.binary === this.binary &&
      m.request !== this.request;
    if (shared) {
      this.pending = m.pending;
      if (m.route !== this.route || m.draft.file !== this.draft?.file || this.busy) {
        return;
      }
    } else if (m.command !== "configurationGraphResult" || m.request !== this.request) {
      return;
    }
    this.busy = false;
    this.status = m.error ?? (m.saved ? t("Saved to {0}", m.draft.file) : "");
    if (m.error) {
      return;
    }
    if (m.catalog) {
      this.catalog = m.catalog;
    }
    this.draft = m.draft;
    this.entries = m.entries;
    this.presetBoard = m.presetBoard ?? "";
    if (m.configured) {
      this.status = t("Preset configured");
    }
    this.staged = m.values;
    this.pending = m.pending;
    if (this.initialSelection) {
      this.selected = this.catalog?.options.find((o) => o.id === this.initialSelection);
      this.initialSelection = undefined;
    }
    if (this.selected) {
      this.edit(this.selected);
    }
  };
  private send(action: string, file = this.draft?.file ?? "", value: string | null = this.value) {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = "";
    this.request = crypto.randomUUID();
    const manual = this.manualDefinitions;
    this.vscodeApi.postMessage({
      command: "configurationGraph",
      action,
      file,
      method: this.method,
      route: this.route,
      id: this.selected?.id,
      value,
      request: this.request,
      revision: this.draft?.revision,
      source: this.source,
      binary: this.binary,
      definitions: manual,
    });
  }
  private browse(route: Route, action = "open") {
    if (this.busy) {
      return;
    }
    this.chooseRoute = false;
    this.route = route;
    this.selected = undefined;
    this.catalog = undefined;
    this.draft = undefined;
    this.query = "";
    this.page = 0;
    this.send(action, "");
  }
  private edit(option: GraphOption) {
    this.selected = option;
    this.value = this.staged[option.id] ?? option.value;
    if (!(option.id in this.staged) && this.route === "kconfig" && option.id in this.entries) {
      const raw = this.entries[option.id];
      try {
        this.value = option.type === "string" ? JSON.parse(raw) : raw;
      } catch {
        this.value = raw;
      }
    }
  }
  private node(title: string, subtitle: string, icon: string, active: boolean, visit: () => void) {
    return html`<button
      class="cg-node"
      ?disabled=${this.busy}
      aria-pressed=${active}
      title=${[title, subtitle].filter(Boolean).join("\n")}
      @click=${visit}
      @dblclick=${visit}
    >
      <i aria-hidden="true" class="codicon codicon-${icon}"></i
      ><span><strong>${title}</strong><small>${subtitle}</small></span>
    </button>`;
  }
  private panStart(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) {
      return;
    }
    const el = e.currentTarget as HTMLElement;
    this.drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  }
  private panMove(e: PointerEvent) {
    if (!this.drag) {
      return;
    }
    const el = e.currentTarget as HTMLElement;
    el.scrollTo(this.drag.left + this.drag.x - e.clientX, this.drag.top + this.drag.y - e.clientY);
  }
  private diagram(rows: GraphOption[]) {
    const appName = this.source.split(/[\\/]/).pop() || t("Application");
    return html`<div
      class="cg-canvas"
      tabindex="0"
      aria-label=${t("Configuration map")}
      @pointerdown=${this.panStart}
      @pointermove=${this.panMove}
      @lostpointercapture=${() => (this.drag = undefined)}
    >
      <div class="cg-tree" data-zoom=${this.zoom}>
        <div class="cg-root">
          ${this.node(appName, t("Application"), "project", false, () => {
            this.chooseRoute = true;
          })}
        </div>
        <div class="cg-branches">
          ${routes.map((route) =>
            this.node(
              t(titles[route]),
              route === "board" ? "BOARD" : route === "device" ? "*.overlay" : "*.conf",
              icons[route],
              this.route === route,
              () => this.browse(route),
            ),
          )}
        </div>
        <div class="cg-leaves" data-route=${this.route}>
          ${rows.map((o) =>
            this.node(
              o.label,
              this.route === "board" ? o.group : o.group + " · " + (this.staged[o.id] ?? o.value),
              o.id in this.staged ? "edit" : "symbol-property",
              this.selected?.id === o.id,
              () => this.edit(o),
            ),
          )}
          ${!rows.length
            ? html`<small>${this.busy ? t("Loading…") : this.catalog?.note || t("No matches")}</small>`
            : nothing}
        </div>
      </div>
    </div>`;
  }
  private inspector() {
    const o = this.selected;
    if (!o) {
      return nothing;
    }
    const choices = o.choices;
    return html`<div class="cg-inspector">
      <strong>${o.label}</strong><small>${o.group} ${o.prompt ? "· " + o.prompt : ""}</small>
      ${this.route === "board" ? nothing : html`<small>${t("Configured value")}: <code>${o.value}</code></small>`}
      ${o.visible === false
        ? html`<small>${t("Inactive in this build; check Kconfig dependencies.")}</small>`
        : nothing}
      ${this.route === "board"
        ? html`<code>BOARD=${o.id}</code>`
        : html`<label
            >${t("Value")}
            ${choices
              ? html`<select @change=${(e: Event) => (this.value = (e.target as HTMLSelectElement).value)}>
                  ${choices.map((v) => html`<option ?selected=${this.value === v}>${v}</option>`)}
                </select>`
              : html`<input
                  .value=${this.value}
                  @input=${(e: Event) => (this.value = (e.target as HTMLInputElement).value)}
                />`}</label
          >`}
      <button ?disabled=${this.busy} @click=${() => this.send("stage")}>${t("Stage change")}</button>
      ${this.route === "kconfig" && o.id in this.entries
        ? html`<button ?disabled=${this.busy} @click=${() => this.send("stage", this.draft?.file, null)}>
            ${t("Remove assignment")}
          </button>`
        : nothing}
      ${o.id in this.staged
        ? html`<button ?disabled=${this.busy} @click=${() => this.send("undo")}>${t("Undo change")}</button>`
        : nothing}
    </div>`;
  }
  private review() {
    const d = this.draft;
    if (!d || !d.keys.length) {
      return nothing;
    }
    const a = d.before.split(/\r?\n/),
      b = d.after.split(/\r?\n/);
    let first = 0;
    while (first < a.length && first < b.length && a[first] === b[first]) {
      first++;
    }
    let endA = a.length,
      endB = b.length;
    while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    return html`<section class="cg-review">
      <strong>${t("Review draft")} · ${d.file}</strong>
      <pre>
${[...a.slice(first, endA).map((s) => "- " + s), ...b.slice(first, endB).map((s) => "+ " + s)].join("\n") ||
        t("No changes")}</pre
      >
      <button class="cg-save" ?disabled=${this.busy || d.before === d.after} @click=${() => this.send("save")}>
        ${t("Save to project")}
      </button>
      <button ?disabled=${this.busy} @click=${() => this.send("discard")}>${t("Discard draft")}</button>
    </section>`;
  }
  private matchingOptions() {
    const options = this.catalog?.options ?? [];
    const query = this.query.trim().toLowerCase();
    if (!query) {
      if (this.route === "kconfig") {
        return [...options].sort((a, b) => Number(b.id in this.entries) - Number(a.id in this.entries));
      }
      return options;
    }
    const matches = fuzzyMatcher(query);
    const rank = (o: GraphOption) => {
      const label = o.label.toLowerCase();
      if (label === query || o.id.toLowerCase() === query) {
        return 0;
      }
      if (label.includes(query) || (o.group + " " + label).toLowerCase().includes(query)) {
        return 1;
      }
      return 2;
    };
    const literal = options.filter((o) => rank(o) < 2);
    return literal.length
      ? literal.sort((a, b) => rank(a) - rank(b))
      : options.filter((o) => matches(o.label) || matches(o.group + " " + o.label));
  }
  private workspace() {
    const rows = this.matchingOptions();
    const size = this.expanded ? 12 : pageSize;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(this.page, pages - 1);
    return html`<div class="cg-tools">
        <input
          class="cg-search"
          type="search"
          aria-label=${t("Search configuration")}
          placeholder=${t("Search configuration")}
          .value=${this.query}
          @input=${(e: Event) => {
            this.query = (e.target as HTMLInputElement).value;
            this.page = 0;
          }}
        />
        <button aria-label=${t("Previous page")} ?disabled=${!page} @click=${() => (this.page = page - 1)}>‹</button>
        <span>${page + 1}/${pages}</span
        ><button aria-label=${t("Next page")} ?disabled=${page + 1 >= pages} @click=${() => (this.page = page + 1)}>
          ›
        </button>
        ${this.catalog && this.draft
          ? html`<label
              >${t("Project file")}
              <select
                ?disabled=${this.busy}
                @change=${(e: Event) => this.send("file", (e.target as HTMLSelectElement).value)}
              >
                ${this.catalog.files.map((f) => html`<option ?selected=${f === this.draft?.file}>${f}</option>`)}
              </select></label
            >`
          : nothing}
        ${this.route === "board" && this.presetBoard
          ? html`<button
              ?disabled=${this.busy || !!this.draft?.keys.length}
              @click=${() => this.send("configurePreset")}
            >
              ${t("Configure preset")} · ${this.presetBoard}
            </button>`
          : nothing}
        <button ?disabled=${this.busy} @click=${() => this.browse(this.route, "reload")}>${t("Refresh")}</button>
      </div>
      ${this.chooseRoute
        ? html`<div class="cg-tools">
            <strong>${t("Choose a route")}</strong> ${routes.map(
              (r) => html`<button @click=${() => this.browse(r)}>${t(titles[r])}</button>`,
            )}
          </div>`
        : nothing}
      ${this.diagram(rows.slice(page * size, (page + 1) * size))}${this.inspector()}${this.review()}
      ${rows.length && this.catalog?.note ? html`<small>${this.catalog.note}</small>` : nothing}
      ${this.pending.length ? html`<small>${t("Draft files")}: ${this.pending.join(", ")}</small>` : nothing}
      <span role="status">${this.status || (this.busy ? t("Loading…") : "")}</span>`;
  }
  render() {
    return html`<section class="cg-panel">
      <header class="cg-view-header">
        ${this.expanded
          ? html`<h2 class="cg-title"><i class="codicon codicon-type-hierarchy"></i> ${t("Configuration map")}</h2>`
          : html`<button
              class="cg-heading"
              aria-expanded=${this.open}
              @click=${() => {
                if (this.expanded) {
                  return;
                }
                this.open = !this.open;
                if (this.open && !this.catalog) {
                  this.browse(this.route);
                }
              }}
            >
              <i class="codicon codicon-type-hierarchy"></i>${t("Configuration map")}
              <i class="codicon codicon-chevron-${this.open ? "up" : "down"}"></i>
            </button>`}
        <div class="cg-view-tools">
          ${this.open
            ? html`<button
                  aria-label=${t("Zoom out")}
                  title=${t("Zoom out")}
                  ?disabled=${this.zoom <= 75}
                  @click=${() => (this.zoom -= 25)}
                >
                  −
                </button>
                <button title=${t("Reset zoom")} @click=${() => (this.zoom = 100)}>${this.zoom}%</button>
                <button
                  aria-label=${t("Zoom in")}
                  title=${t("Zoom in")}
                  ?disabled=${this.zoom >= 175}
                  @click=${() => (this.zoom += 25)}
                >
                  +
                </button>`
            : nothing}
          ${this.expanded
            ? nothing
            : html`<button ?disabled=${this.busy} @click=${() => this.openEditor(false)}>
                <i class="codicon codicon-screen-full"></i> ${t("Open in full editor")}
              </button>`}
          <button ?disabled=${this.busy} @click=${() => this.openEditor(true)}>
            <i class="codicon codicon-empty-window"></i> ${t("Open in new window")}
          </button>
        </div>
      </header>
      ${this.open ? this.workspace() : nothing}
    </section>`;
  }
}
