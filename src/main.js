import { parseCustomizer, toDefineArgs } from "./customizer.js";
import { createViewer } from "./viewer.js";
import { PRINTERS } from "./printers.js";
import { FILAMENT_COLORS } from "./colors.js";
import source from "../scad/openGrid.scad?raw";

// Customizer groups hidden from the panel (fine-tuning details, not board topology/size).
const HIDDEN_GROUPS = new Set(["Advanced - Tile Parameters", "Tile Stacking", "Beta - Fill Space"]);

const $ = (id) => document.getElementById(id);
const viewer = createViewer($("viewer"));
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

const params = parseCustomizer(source).filter((p) => !HIDDEN_GROUPS.has(p.group));
const values = Object.fromEntries(params.map((p) => [p.name, p.value]));
const setters = {}; // param name -> fn(value) that updates its form control
let latestStl = null;
let latestBox = null;
let printer = PRINTERS[0];
let renderId = 0;
let firstRender = true;

// ---- printer dropdown -------------------------------------------------------
const printerSel = $("printer");
for (const p of PRINTERS) printerSel.appendChild(new Option(p.name, p.id));
printerSel.onchange = () => {
  printer = PRINTERS.find((p) => p.id === printerSel.value);
  viewer.setBed(printer.bed);
  fitToPlate();
};
viewer.setBed(printer.bed);

// Largest board (in 28 mm cells) that fits the selected plate.
function fitToPlate() {
  const [w, h] = printer.bed;
  setters.Board_Width?.(Math.max(1, Math.floor(w / 28)));
  setters.Board_Height?.(Math.max(1, Math.floor(h / 28)));
  render();
}

// ---- filament color swatches ------------------------------------------------
const COLOR_KEY = "opengrid.color";
let saved = null;
try { saved = localStorage.getItem(COLOR_KEY); } catch {}
let color = FILAMENT_COLORS.find((c) => c.code === saved) || FILAMENT_COLORS.find((c) => c.name === "Pumpkin Orange");
const swatches = $("colors");
for (const c of FILAMENT_COLORS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.style.background = c.hex;
  b.title = `${c.name} (${c.code})`;
  b.setAttribute("aria-label", c.name);
  b.onclick = () => selectColor(c);
  swatches.appendChild(b);
}
function selectColor(c) {
  color = c;
  viewer.setColor(c.hex);
  $("colorName").textContent = `${c.name} · ${c.code}`;
  for (const b of swatches.children) b.classList.toggle("selected", b.title.startsWith(c.name + " ("));
  try { localStorage.setItem(COLOR_KEY, c.code); } catch {}
}
selectColor(color);

// ---- board-edge widget ------------------------------------------------------
// Per-corner / per-edge booleans are shown as a clickable top-down board diagram
// instead of eight checkboxes. Maps widget positions to Customizer variable names.
const SPATIAL = {
  corners: { TL: "Chamfer_Top_Left", TR: "Chamfer_Top_Right", BL: "Chamfer_Bottom_Left", BR: "Chamfer_Bottom_Right" },
  edges: { T: "Connector_Holes_Top", B: "Connector_Holes_Bottom", L: "Connector_Holes_Left", R: "Connector_Holes_Right" },
};
let syncBoardWidget = () => {};
const SPATIAL_NAMES = new Set([...Object.values(SPATIAL.corners), ...Object.values(SPATIAL.edges)]);

function buildBoardWidget() {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const wrap = document.createElement("div");
  wrap.className = "board-widget";
  const svg = el("svg", { viewBox: "0 0 120 120", role: "group", "aria-label": "Board corners and edges" });
  svg.appendChild(el("rect", { x: 14, y: 14, width: 92, height: 92, rx: 6, class: "board" }));
  // faint grid lines so it reads as an openGrid tile
  for (let i = 1; i < 4; i++) {
    svg.appendChild(el("line", { x1: 14 + i * 23, y1: 14, x2: 14 + i * 23, y2: 106, class: "grid" }));
    svg.appendChild(el("line", { x1: 14, y1: 14 + i * 23, x2: 106, y2: 14 + i * 23, class: "grid" }));
  }
  const buttons = [];
  const add = (shape, name, label) => {
    shape.classList.add("hit");
    shape.setAttribute("tabindex", "0");
    shape.setAttribute("role", "checkbox");
    shape.setAttribute("aria-label", label);
    const title = el("title", {}); title.textContent = label; shape.appendChild(title);
    const toggle = () => { values[name] = !values[name]; sync(); scheduleRender(); };
    shape.addEventListener("click", toggle);
    shape.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
    buttons.push([shape, name]);
    svg.appendChild(shape);
    setters[name] = (v) => { values[name] = v; sync(); };
  };
  // edges: connector holes (pills along each side)
  add(el("rect", { x: 34, y: 6, width: 52, height: 12, rx: 6 }), SPATIAL.edges.T, "Connector holes: top edge");
  add(el("rect", { x: 34, y: 102, width: 52, height: 12, rx: 6 }), SPATIAL.edges.B, "Connector holes: bottom edge");
  add(el("rect", { x: 6, y: 34, width: 12, height: 52, rx: 6 }), SPATIAL.edges.L, "Connector holes: left edge");
  add(el("rect", { x: 102, y: 34, width: 12, height: 52, rx: 6 }), SPATIAL.edges.R, "Connector holes: right edge");
  // corners: chamfers (diagonal-cut squares)
  const corner = (cx, cy) => el("circle", { cx, cy, r: 9 });
  add(corner(14, 14), SPATIAL.corners.TL, "Chamfer: top-left corner");
  add(corner(106, 14), SPATIAL.corners.TR, "Chamfer: top-right corner");
  add(corner(14, 106), SPATIAL.corners.BL, "Chamfer: bottom-left corner");
  add(corner(106, 106), SPATIAL.corners.BR, "Chamfer: bottom-right corner");
  const edgeNames = new Set(Object.values(SPATIAL.edges));
  function sync() {
    const edgesOn = values.Connector_Holes !== false;
    const cornersOn = values.Chamfers !== "None";
    for (const [shape, name] of buttons) {
      shape.classList.toggle("on", !!values[name]);
      shape.classList.toggle("off", edgeNames.has(name) ? !edgesOn : !cornersOn);
      shape.setAttribute("aria-checked", String(!!values[name]));
    }
  }
  sync();
  syncBoardWidget = sync;
  wrap.appendChild(svg);
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = '<span><i class="sw corner"></i> corner chamfer</span><span><i class="sw edge"></i> edge connector holes</span>';
  wrap.appendChild(legend);
  return wrap;
}

// ---- parameter form ---------------------------------------------------------
function buildForm() {
  const form = $("params");
  let group = null;
  let widgetPlaced = false;
  for (const p of params) {
    if (SPATIAL_NAMES.has(p.name)) {
      // First per-corner/edge variable: put the board diagram here, skip the checkboxes.
      if (!widgetPlaced) { form.appendChild(buildBoardWidget()); widgetPlaced = true; }
      continue;
    }
    if (p.group !== group) {
      group = p.group;
      const h = document.createElement("h2");
      h.textContent = group;
      form.appendChild(h);
    }
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = p.name.replaceAll("_", " ");
    label.htmlFor = p.name;
    field.appendChild(label);

    const set = (v) => { values[p.name] = v; syncBoardWidget(); scheduleRender(); };
    if (p.type === "bool") {
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", id: p.name, checked: p.value });
      cb.onchange = () => set(cb.checked);
      field.appendChild(cb);
    } else if (p.type === "choice") {
      const sel = document.createElement("select");
      sel.id = p.name;
      for (const o of p.options) sel.appendChild(new Option(String(o), String(o)));
      sel.value = String(p.value);
      sel.onchange = () => set(typeof p.value === "number" ? Number(sel.value) : sel.value);
      field.appendChild(sel);
    } else if (p.type === "range") {
      const num = Object.assign(document.createElement("input"), { type: "number", id: p.name, min: p.min, max: p.max, step: p.step, value: p.value });
      const range = Object.assign(document.createElement("input"), { type: "range", min: p.min, max: p.max, step: p.step, value: p.value });
      num.onchange = () => { range.value = num.value; set(Number(num.value)); };
      range.oninput = () => { num.value = range.value; };
      range.onchange = () => set(Number(range.value));
      setters[p.name] = (v) => { num.value = v; range.value = v; values[p.name] = v; };
      field.appendChild(num);
      const wrap = document.createElement("div");
      wrap.className = "range";
      wrap.appendChild(range);
      field.appendChild(wrap);
    } else {
      const inp = Object.assign(document.createElement("input"), { type: p.type === "number" ? "number" : "text", id: p.name, value: p.value });
      if (p.type === "number") inp.min = 1;
      inp.onchange = () => set(p.type === "number" ? Number(inp.value) : inp.value);
      setters[p.name] = (v) => { inp.value = v; values[p.name] = v; };
      field.appendChild(inp);
    }
    if (p.description) {
      const s = document.createElement("small");
      s.textContent = p.description;
      field.appendChild(s);
    }
    form.appendChild(field);
  }
}

// ---- rendering --------------------------------------------------------------
let debounce;
function scheduleRender() {
  if (!$("auto").checked) return;
  clearTimeout(debounce);
  debounce = setTimeout(render, 250);
}

// One render in flight at a time; edits made meanwhile collapse into a single follow-up render.
let inFlight = false;
let pending = false;
function render() {
  if (inFlight) { pending = true; return; }
  inFlight = true;
  const id = ++renderId;
  setStatus("Rendering…");
  $("render").disabled = true;
  worker.postMessage({ id, source, defineArgs: toDefineArgs(values) });
}

worker.onmessage = ({ data }) => {
  inFlight = false;
  if (pending) { pending = false; render(); return; }
  if (data.id !== renderId) return; // stale result
  $("render").disabled = false;
  $("log").textContent = data.log.join("\n");
  if (data.error) {
    setStatus(`Render failed: ${data.error}`, true);
    return;
  }
  latestStl = data.stl;
  latestBox = viewer.setStl(latestStl.buffer, { refit: firstRender });
  firstRender = false;
  updateStatus(`Rendered in ${(data.ms / 1000).toFixed(1)} s`);
  $("export").disabled = false;
};

let lastRenderNote = "";
function updateStatus(note) {
  if (note !== undefined) lastRenderNote = note;
  if (!latestBox) return;
  const s = latestBox.max.clone().sub(latestBox.min);
  const [bw, bh, bz] = printer.bed;
  const fits = s.x <= bw && s.y <= bh && s.z <= bz;
  setStatus(`${lastRenderNote} — ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm — `
    + (fits ? `fits ${printer.name}` : `exceeds ${printer.name} plate (${bw} × ${bh} mm)`), !fits);
}

function setStatus(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

// ---- export to Bambu Studio -------------------------------------------------
$("export").onclick = async () => {
  if (!latestStl) return;
  const name = `opengrid_${values.Full_or_Lite}_${values.Board_Width}x${values.Board_Height}`.toLowerCase();
  setStatus("Sending to Bambu Studio…");
  try {
    const res = await fetch(`/api/export?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: latestStl,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    setStatus(`Opened ${body.path} in Bambu Studio`);
  } catch (err) {
    setStatus(`Export failed: ${err.message}`, true);
  }
};

$("render").onclick = render;
buildForm();
fitToPlate();
