import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

interface RequestDraft {
  name: string; collection: number; folder: string; method: string;
  url: string; headers: string; body: string; bearer: string; postman_item?: unknown;
}
interface Collection {
  name: string; version: string; docs: string; folders: string[];
  environments: Record<string, string>; headers: string; variables: string;
  expected_status: string; postman_collection?: unknown;
}
interface Workspace { collections: Collection[]; requests: RequestDraft[] }
interface ResponseData {
  status: string; elapsed_ms: number; headers: string; body: string; bytes: number; truncated: boolean;
}
interface Sent { response: ResponseData; expected_status: number | null }
interface Imported { collection: Collection; requests: RequestDraft[] }

const emptyCollection = (name: string): Collection => ({
  name, version: "", docs: "", folders: [], environments: Object.create(null),
  headers: "", variables: "", expected_status: "",
});
const emptyRequest = (collection: number): RequestDraft => ({
  name: "", collection, folder: "", method: "GET", url: "", headers: "", body: "", bearer: "",
});

const app = document.querySelector<HTMLDivElement>("#app")!;
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const collectionTabs = ["Overview", "Headers", "Vars", "Auth", "Tests", "Environments"] as const;
const requestTabs = ["Params", "Headers", "Body", "Auth"] as const;

let workspace: Workspace;
let active = 0;
let draft = emptyRequest(active);
let selected: number | undefined;
let collectionView = true;
let collectionTab: typeof collectionTabs[number] = "Overview";
let requestTab: typeof requestTabs[number] = "Params";
let environment: string | null = null;
let historyTab = false;
let filter = "";
let history: RequestDraft[] = [];
let sending = false;
let draftRevision = 0;
let response: Sent | string | undefined;
let responseHeaders = false;
let notice: { message: string; error: boolean } | undefined;
let saveTimer: number | undefined;
let queue = Promise.resolve();
let statusArea: HTMLElement;
const tokens = new Map<number, string>();
const expanded = new Map<string, boolean>();

function current() { return workspace.collections[active]; }
function collectionRequests() { return workspace.requests.filter(request => request.collection === active); }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, css = "", text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = css;
  if (text) element.textContent = text;
  return element;
}
function button(text: string, action: () => void, css = "") {
  const control = node("button", css, text);
  control.type = "button";
  control.addEventListener("click", action);
  return control;
}
function group(css: string, ...children: (HTMLElement | string)[]) {
  const parent = node("div", css);
  parent.append(...children);
  return parent;
}
function field(caption: string, input: HTMLElement) {
  const label = node("label", "field");
  label.append(node("span", "", caption), input);
  return label;
}
function input(value: string, label: string, change: (value: string) => void, css = "") {
  const control = node("input", css);
  control.value = value;
  control.placeholder = label;
  control.setAttribute("aria-label", label);
  control.addEventListener("input", () => change(control.value));
  return control;
}
function select(value: string, entries: [string, string][], label: string, change: (value: string) => void) {
  const control = node("select");
  control.setAttribute("aria-label", label);
  for (const [key, title] of entries) {
    const option = node("option", "", title);
    option.value = key;
    control.append(option);
  }
  control.value = value;
  control.addEventListener("change", () => change(control.value));
  return control;
}
function editor(value: string, label: string, change: (value: string) => void) {
  const control = node("textarea", "mono");
  control.value = value;
  control.spellcheck = false;
  control.placeholder = label;
  control.setAttribute("aria-label", label);
  control.addEventListener("input", () => change(control.value));
  return control;
}
function tell(message: string, error = false) {
  notice = { message, error };
  showNotice();
}
function showNotice() {
  if (!statusArea) return;
  statusArea.hidden = !notice;
  statusArea.classList.toggle("error", notice?.error ?? false);
  statusArea.textContent = notice?.message ?? "";
}
function flushSave() {
  if (saveTimer === undefined) return;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  const snapshot = structuredClone(workspace);
  queue = queue.then(() => invoke<void>("save_workspace", { workspace: snapshot }))
    .catch(error => tell(String(error), true));
}
function save(immediate = false) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 240);
  if (immediate) flushSave();
}

function variables() {
  const values = new Map<string, string>();
  for (const block of [current().variables, environment === null ? "" : current().environments[environment] ?? ""]) {
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const pivot = line.indexOf("=");
      if (pivot < 1 || !line.slice(0, pivot).trim()) return null;
      values.set(line.slice(0, pivot).trim(), line.slice(pivot + 1).trim());
    }
  }
  return values;
}

const tooltip = node("div", "variable-tooltip");
tooltip.role = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);
function hideTooltip() { tooltip.hidden = true; }

function templateHover(control: HTMLInputElement | HTMLTextAreaElement) {
  // A mirror runs the browser's own text layout for determining which placeholder is under the mouse.
  control.addEventListener("pointermove", rawEvent => {
    const event = rawEvent as PointerEvent;
    const references = Array.from(control.value.matchAll(/\{\{(.*?)\}\}/gs));
    if (!references.length) { hideTooltip(); return; }
    const box = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    const mirror = node("div", "field-mirror");
    Object.assign(mirror.style, {
      left: `${box.left + control.clientLeft}px`, top: `${box.top + control.clientTop}px`,
      width: `${control.clientWidth}px`, height: `${control.clientHeight}px`,
      padding: style.padding, font: style.font, lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing, tabSize: style.tabSize,
      whiteSpace: control instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
      overflowWrap: control instanceof HTMLTextAreaElement ? "break-word" : "normal",
    });
    let offset = 0;
    const spans: [HTMLSpanElement, string][] = [];
    for (const ref of references) {
      const index = ref.index;
      mirror.append(control.value.slice(offset, index));
      const span = node("span", "", ref[0]);
      mirror.append(span);
      spans.push([span, ref[1].trim()]);
      offset = index + ref[0].length;
    }
    mirror.append(control.value.slice(offset));
    document.body.append(mirror);
    mirror.scrollTop = control.scrollTop;
    mirror.scrollLeft = control.scrollLeft;
    const hit = spans.find(([span]) => [...span.getClientRects()].some(rect =>
      event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom,
    ));
    mirror.remove();
    if (!hit) { hideTooltip(); return; }
    const name = hit[1];
    const values = variables();
    tooltip.replaceChildren(node("strong", "", `{{${name}}}`), node("div", "", values === null
      ? "Invalid variable configuration" : values.get(name) ?? "Undefined variable"));
    if (values?.get(name) === "") tooltip.lastElementChild!.textContent = "(empty value)";
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(event.clientX + 12, innerWidth - tooltip.offsetWidth - 10)}px`;
    tooltip.style.top = `${Math.min(event.clientY + 18, innerHeight - tooltip.offsetHeight - 10)}px`;
  });
  for (const event of ["pointerleave", "input", "scroll", "blur"]) control.addEventListener(event, hideTooltip);
}

type PairMode = "headers" | "variables" | "query";
function pairTable(text: string, mode: PairMode, change: (text: string) => void, hover = false) {
  const rowSeparator = mode === "query" ? "&" : "\n";
  const valueSeparator = mode === "headers" ? ":" : "=";
  const rows = text.split(rowSeparator).filter(Boolean).map(line => {
    const pivot = line.indexOf(valueSeparator);
    return {
      name: pivot < 0 ? line : line.slice(0, pivot),
      value: pivot < 0 ? "" : mode === "headers" ? line.slice(pivot + 1).replace(/^ /, "") : line.slice(pivot + 1),
      hasSeparator: pivot >= 0,
    };
  });
  const panel = node("div", "pairs");
  const grid = node("div", "pair-grid");
  const add = button("+ Add row", () => addRow({ name: "", value: "", hasSeparator: true }, true));
  panel.append(add, grid);
  grid.append(node("span", "pair-label", "Name"), node("span", "pair-label", "Value"), node("span"));
  function persist() {
    change(rows.filter(row => row.name || row.value).map(row =>
      row.name + (row.hasSeparator ? valueSeparator + row.value : ""),
    ).join(rowSeparator));
  }
  function addRow(row: typeof rows[number], focus = false) {
    if (focus) rows.push(row);
    const name = input(row.name, "Name", text => {
      row.name = text;
      if (mode !== "query") row.hasSeparator = true;
      persist();
    }, "mono");
    const value = input(row.value, "Value", text => {
      row.value = text;
      row.hasSeparator = true;
      persist();
    }, "mono");
    if (hover) { templateHover(name); templateHover(value); }
    const remove = button("×", () => {
      rows.splice(rows.indexOf(row), 1);
      name.remove(); value.remove(); remove.remove();
      persist();
      if (!rows.length) addRow({ name: "", value: "", hasSeparator: true }, true);
    }, "icon-button");
    remove.setAttribute("aria-label", "Remove row");
    grid.append(name, value, remove);
    if (focus) name.focus();
  }
  if (!rows.length) rows.push({ name: "", value: "", hasSeparator: true });
  for (const row of rows) addRow(row);
  return panel;
}

function switchCollection(index: number) {
  if (index !== active) environment = null;
  active = index;
  collectionView = true;
  expanded.set(`collection-${active}`, true);
}
function openDraft(request: RequestDraft, index?: number) {
  switchCollection(request.collection);
  draft = { ...request };
  selected = index;
  draftRevision++;
  response = undefined;
  responseHeaders = false;
  collectionView = false;
  render();
}

function sidebar() {
  const aside = node("aside", "sidebar");
  aside.append(node("h1", "brand", "Postdove"));
  aside.append(group("tabs sidebar-tabs",
    button("Collections", () => { historyTab = false; render(); }, !historyTab ? "active" : ""),
    button("History", () => { historyTab = true; render(); }, historyTab ? "active" : ""),
  ));
  const list = node("div", "tree");
  aside.append(input(filter, "Filter requests", value => { filter = value; renderTree(); }));
  if (!historyTab) {
    const name = input("", "Collection name", () => {});
    const add = () => {
      if (!name.value.trim()) { name.focus(); return; }
      workspace.collections.push(emptyCollection(name.value.trim()));
      switchCollection(workspace.collections.length - 1);
      collectionTab = "Overview";
      save(true);
      render();
    };
    name.addEventListener("keydown", event => { if (event.key === "Enter") add(); });
    const create = button("+", add, "icon-button");
    create.setAttribute("aria-label", "Create collection");
    aside.append(group("inline-form", name, create));
  }
  aside.append(list);
  function renderTree() {
    list.replaceChildren();
    const needle = filter.trim().toLowerCase();
    const matches = (request: RequestDraft) => [request.name, request.method, request.url].some(value => value.toLowerCase().includes(needle));
    function requestRow(request: RequestDraft, index?: number) {
      const row = button("", () => openDraft(request, index), "request-row");
      if (!collectionView && index !== undefined && selected === index) row.classList.add("active");
      row.append(node("span", "method mono", request.method), node("span", "truncate", request.name || request.url));
      row.title = request.name || request.url;
      return row;
    }
    if (historyTab) {
      for (const request of history.filter(matches)) list.append(requestRow(request));
      if (!list.children.length) list.append(node("p", "muted", "No matching history."));
      return;
    }
    workspace.collections.forEach((collection, index) => {
      const key = `collection-${index}`;
      const section = node("details", "tree-section");
      section.open = expanded.get(key) ?? index === active;
      section.addEventListener("toggle", () => expanded.set(key, section.open));
      section.append(node("summary", "", collection.name || "Untitled collection"));
      section.append(button("Collection settings", () => { switchCollection(index); render(); },
        collectionView && active === index ? "active" : ""));
      const requests = workspace.requests.map((request, position) => ({ request, position }))
        .filter(({ request }) => request.collection === index && matches(request));
      for (const { request, position } of requests.filter(({ request }) => !request.folder)) section.append(requestRow(request, position));
      const folders = new Map<string, HTMLDetailsElement>();
      function makeFolder(path: string): HTMLDetailsElement {
        const existing = folders.get(path);
        if (existing) return existing;
        const bits = path.split("/");
        const name = bits.pop() ?? path;
        const parent = bits.length ? makeFolder(bits.join("/")) : section;
        const folder = node("details", "tree-folder");
        const folderKey = `${key}/${path}`;
        folder.open = expanded.get(folderKey) ?? true;
        folder.addEventListener("toggle", () => expanded.set(folderKey, folder.open));
        folder.append(node("summary", "", name));
        parent.append(folder);
        folders.set(path, folder);
        return folder;
      }
      for (const folder of collection.folders) makeFolder(folder);
      for (const { request, position } of requests.filter(({ request }) => request.folder)) {
        makeFolder(request.folder).append(requestRow(request, position));
      }
      list.append(section);
    });
  }
  renderTree();
  return aside;
}

function toolbar() {
  const importButton = button("Import collection", async () => {
    importButton.disabled = true;
    try {
      const result = await invoke<Imported | null>("import_collection");
      if (!result) return;
      const index = workspace.collections.length;
      workspace.collections.push(result.collection);
      workspace.requests.push(...result.requests.map(request => ({ ...request, collection: index, bearer: "" })));
      switchCollection(index);
      collectionTab = "Overview";
      historyTab = false;
      save(true);
      tell(`Imported ${result.collection.name} (${result.requests.length} requests).`);
      render();
    } catch (error) { tell(String(error), true); }
    finally { importButton.disabled = false; }
  });

  const exportButton = button("Export collection", async () => {
    exportButton.disabled = true;
    try {
      const requests = collectionRequests();
      const path = await invoke<string | null>("export_collection", { collection: current(), requests });
      if (path) tell(`Exported ${requests.length} requests to ${path}.`);
    } catch (error) { tell(String(error), true); }
    finally { exportButton.disabled = false; }
  });

  return group("toolbar",
    node("strong", "toolbar-title truncate", current().name || "Untitled collection"),
    button("Collection", () => { collectionView = true; render(); }, collectionView ? "active" : ""),
    button("+ New request", () => openDraft(emptyRequest(active))),
    importButton,
    exportButton,
    select(environment ?? "", [["", "No environment"], ...Object.keys(current().environments).sort().map(name => [name, name] as [string, string])],
      "Active environment", value => { environment = value || null; render(); }),
  );
}

function settings() {
  const collection = current();
  const content = node("section", "settings");
  content.append(group("tabs border-tabs", ...collectionTabs.map(tab =>
    button(tab, () => { collectionTab = tab; render(); }, tab === collectionTab ? "active" : ""))));
  const panel = node("div", "settings-content");
  content.append(panel);
  switch (collectionTab) {
    case "Overview": {
      const name = field("Name", input(collection.name, "Collection name", value => {
        collection.name = value;
        document.querySelector(".toolbar-title")!.textContent = value || "Untitled collection";
        const sidebarName = document.querySelectorAll<HTMLElement>(".tree-section > summary")[active];
        if (sidebarName) sidebarName.textContent = value || "Untitled collection";
        save();
      }));
      const version = field("Version", input(collection.version, "Not set", value => { collection.version = value; save(); }));
      const folderName = input("", "Folder name", () => {});
      const folderCreate = () => {
        const folder = folderName.value.trim();
        if (!folder || folder.includes("/") || collection.folders.includes(folder)) {
          tell("Enter a unique folder name without '/'." , true);
          return;
        }
        collection.folders.push(folder);
        save(true);
        render();
      };
      folderName.addEventListener("keydown", event => { if (event.key === "Enter") folderCreate(); });
      const docs = editor(collection.docs, "Describe the collection in Markdown…", value => { collection.docs = value; save(); });
      docs.classList.add("docs");
      const details = group("detail-column",
        node("h2", "", "Collection details"), name, version,
        node("p", "muted", `${collectionRequests().length} requests · ${Object.keys(collection.environments).length} environments`),
        node("h3", "", "Folders"),
        ...collection.folders.map(folder => node("p", "folder-name", folder)),
        group("inline-form", folderName, button("Add folder", folderCreate)),
        button("Copy collection JSON", async () => {
          try {
            const json = await invoke<string>("collection_json", { collection, requests: collectionRequests() });
            await copy(json);
          } catch (error) { tell(String(error), true); }
        }),
      );
      panel.append(group("overview", details, group("detail-column", node("h2", "", "Documentation"), docs,
        button("Copy Markdown", () => { void copy(collection.docs); }))));
      break;
    }
    case "Headers":
      panel.append(node("p", "muted", "Request headers override collection defaults."),
        pairTable(collection.headers, "headers", text => { collection.headers = text; save(); }, true));
      break;
    case "Vars":
      panel.append(node("p", "muted", "Reference collection variables with {{name}}."),
        pairTable(collection.variables, "variables", text => { collection.variables = text; save(); }));
      break;
    case "Auth": {
      const token = input(tokens.get(active) ?? "", "Bearer token", value => tokens.set(active, value));
      token.type = "password";
      panel.append(node("p", "muted", "Default for this session. A request token takes precedence."), token);
      break;
    }
    case "Tests":
      panel.append(field("Expected HTTP status", input(collection.expected_status, "200", value => { collection.expected_status = value; save(); })));
      break;
    case "Environments": {
      const name = input("", "Environment name", () => {});
      const add = () => {
        const value = name.value.trim();
        if (!value || Object.hasOwn(collection.environments, value)) {
          tell("Enter a unique environment name.", true);
          return;
        }
        Object.defineProperty(collection.environments, value, { value: "", writable: true, enumerable: true, configurable: true });
        environment = value;
        save(true);
        render();
      };
      name.addEventListener("keydown", event => { if (event.key === "Enter") add(); });
      panel.append(group("inline-form", name, button("Add environment", add)));
      const activeEnvironment = environment;
      if (activeEnvironment !== null) {
        panel.append(node("p", "muted", `${activeEnvironment} overrides collection variables.`),
          pairTable(collection.environments[activeEnvironment] ?? "", "variables", text => {
            collection.environments[activeEnvironment] = text;
            save();
          }));
      }
      break;
    }
  }
  return content;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    tell("Copied to clipboard.");
  } catch (error) { tell(String(error), true); }
}

function saveDraft() {
  if (!draft.url.trim()) return;
  if (!draft.name.trim()) draft.name = draft.url.trim();
  const record = { ...draft, bearer: "" };
  if (selected === undefined) {
    selected = workspace.requests.push(record) - 1;
  } else {
    workspace.requests[selected] = record;
  }
  save(true);
  render();
}

function splitUrl(url: string) {
  const hash = url.indexOf("#");
  const fragment = hash < 0 ? "" : url.slice(hash);
  const address = hash < 0 ? url : url.slice(0, hash);
  const pivot = address.indexOf("?");
  return { base: pivot < 0 ? address : address.slice(0, pivot), query: pivot < 0 ? "" : address.slice(pivot + 1), fragment };
}

async function sendDraft() {
  if (sending || collectionView || !draft.url.trim()) return;
  const revision = draftRevision;
  const request = { ...draft };
  history.unshift({ ...request, bearer: "" });
  history = history.slice(0, 30);
  sending = true;
  response = undefined;
  responseHeaders = false;
  render();
  try {
    const result = await invoke<Sent>("send_request", {
      request, collection: current(), environment, bearer: tokens.get(active) ?? "",
    });
    if (revision === draftRevision) response = result;
  } catch (error) {
    if (revision === draftRevision) response = String(error);
  } finally {
    sending = false;
    render();
  }
}

function requestView() {
  let url: HTMLInputElement;
  const saveButton = button("Save", saveDraft);
  const sendButton = button(sending ? "Sending…" : "Send", () => { void sendDraft(); }, "primary");
  const syncButtons = () => {
    saveButton.disabled = !draft.url.trim();
    sendButton.disabled = sending || !draft.url.trim();
  };
  url = input(draft.url, "https://api.example.com/items", value => {
    const oldQuery = splitUrl(draft.url).query;
    draft.url = value;
    syncButtons();
    if (requestTab === "Params" && splitUrl(value).query !== oldQuery) {
      area.replaceChildren(requestPane());
    }
  }, "mono");
  url.spellcheck = false;
  templateHover(url);
  const methodsForDraft = methods.includes(draft.method) ? methods : [draft.method, ...methods];
  const method = select(draft.method, methodsForDraft.map(value => [value, value]), "HTTP method", value => { draft.method = value; });
  const bar = group("request-meta",
    input(draft.name, "Untitled request", value => { draft.name = value; }),
    select(draft.folder, [["", "Collection root"], ...current().folders.map(folder => [folder, folder] as [string, string])],
      "Request folder", value => { draft.folder = value; }),
    saveButton,
  );
  if (selected !== undefined) bar.append(button("Remove saved", () => {
    if (selected === undefined) return;
    workspace.requests.splice(selected, 1);
    selected = undefined;
    save(true);
    render();
  }));
  syncButtons();
  const area = group("request-side");
  area.append(requestPane());
  return group("request-view", bar, group("url-bar", method, url, sendButton),
    group("split", area, responsePane()));

  function requestPane() {
    const panel = node("section", "request-pane");
    panel.append(node("h2", "", "Request"), group("tabs border-tabs", ...requestTabs.map(tab =>
      button(tab, () => { requestTab = tab; area.replaceChildren(requestPane()); }, requestTab === tab ? "active" : ""))));
    switch (requestTab) {
      case "Params":
        panel.append(pairTable(splitUrl(draft.url).query, "query", text => {
          const { base, fragment } = splitUrl(draft.url);
          draft.url = base + (text ? "?" + text : "") + fragment;
          url.value = draft.url;
          syncButtons();
        }, true));
        break;
      case "Headers":
        panel.append(pairTable(draft.headers, "headers", text => { draft.headers = text; }, true));
        break;
      case "Body": {
        const body = editor(draft.body, "Raw request body", value => { draft.body = value; });
        templateHover(body);
        panel.append(body);
        break;
      }
      case "Auth": {
        const bearer = input(draft.bearer, "Bearer token", value => { draft.bearer = value; });
        bearer.type = "password";
        panel.append(bearer);
        break;
      }
    }
    return panel;
  }
}

function responsePane() {
  const pane = node("section", "response-pane");
  pane.append(node("h2", "", "Response"));
  if (!response || typeof response === "string") {
    pane.append(node("p", typeof response === "string" ? "error-text" : "muted",
      response ?? (sending ? "Waiting for response…" : "Send a request to inspect its response.")));
    return pane;
  }
  const { response: data, expected_status } = response;
  const status = Number(data.status.split(" ")[0]);
  const stats = group("response-meta",
    node("strong", status >= 400 ? "error-text mono" : "success mono", data.status),
    node("span", "muted", `${data.elapsed_ms} ms · ${data.bytes} bytes${data.truncated ? " shown (truncated)" : ""}`),
  );
  if (expected_status !== null) {
    const passed = status === expected_status;
    stats.append(node("span", passed ? "success" : "error-text", `${passed ? "PASS" : "FAIL"} · expected ${expected_status}`));
  }
  const output = node("pre", "response-output", responseHeaders ? data.headers : data.body);
  const bodyTab = button("Body", () => show(false), !responseHeaders ? "active" : "");
  const headersTab = button("Headers", () => show(true), responseHeaders ? "active" : "");
  function show(headers: boolean) {
    responseHeaders = headers;
    bodyTab.classList.toggle("active", !headers);
    headersTab.classList.toggle("active", headers);
    output.textContent = headers ? data.headers : data.body;
  }
  pane.append(stats, group("tabs border-tabs", bodyTab, headersTab,
    button("Copy", () => { void copy(output.textContent ?? ""); })), output);
  return pane;
}

function render() {
  hideTooltip();
  statusArea = node("div", "notice");
  statusArea.role = "status";
  const main = node("main", "main");
  main.append(toolbar(), statusArea, collectionView ? settings() : requestView());
  app.replaceChildren(sidebar(), main);
  showNotice();
}

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    void sendDraft();
  }
});
window.addEventListener("pagehide", flushSave);

invoke<Workspace>("load_workspace").then(data => {
  workspace = data;
  if (!workspace.collections.length) workspace.collections.push(emptyCollection("Local collection"));
  for (const request of workspace.requests) {
    if (!workspace.collections[request.collection]) request.collection = 0;
  }
  render();
}).catch(error => {
  app.replaceChildren(node("main", "startup-error", `Could not load Postdove workspace. ${String(error)}`));
});
