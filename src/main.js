import { parseCustomizer, toDefineArgs } from "./customizer.js";
import { createViewer } from "./viewer.js";
import { PRINTERS } from "./printers.js";
import { FILAMENT_COLORS } from "./colors.js";
import source from "../scad/openGrid.scad?raw";
import connectorSource from "../scad/connector.scad?raw";

// Customizer groups hidden from the panel (fine-tuning details, not board topology/size).
const HIDDEN_GROUPS = new Set(["Advanced - Tile Parameters", "Tile Stacking", "Beta - Fill Space"]);
// Individual fine-tuning variables hidden from the panel (defaults suit M4 / #8 screws).
const HIDDEN_PARAMS = new Set([
  "Board_Width", "Board_Height", "Screw_Mounting", // edited on the model (drag arrows / click rings)
  "Screw_Every_X_Rows", "Screw_Every_X_Columns", "Screw_Diameter", "Screw_Head_Diameter",
  "Screw_Head_Inset", "Screw_Head_Is_CounterSunk", "Screw_Head_CounterSunk_Degree",
]);

const $ = (id) => document.getElementById(id);
const viewer = createViewer($("viewer"));
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

const allParams = parseCustomizer(source).filter((p) => !HIDDEN_GROUPS.has(p.group));
const params = allParams.filter((p) => !HIDDEN_PARAMS.has(p.name)); // shown in the form
const values = Object.fromEntries(allParams.map((p) => [p.name, p.value])); // includes on-model ones
window.__values = values; // debugging aid: inspect current parameters from the console
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
  values.Board_Width = Math.max(1, Math.floor(w / 28));
  values.Board_Height = Math.max(1, Math.floor(h / 28));
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

// ---- on-model handles -------------------------------------------------------
// Per-corner / per-edge booleans and screw positions are edited by clicking handles on the 3D
// model rather than via form fields. These map handle positions to Customizer variable names.
const SPATIAL = {
  corners: { TL: "Chamfer_Top_Left", TR: "Chamfer_Top_Right", BL: "Chamfer_Bottom_Left", BR: "Chamfer_Bottom_Right" },
  edges: { T: "Connector_Holes_Top", B: "Connector_Holes_Bottom", L: "Connector_Holes_Left", R: "Connector_Holes_Right" },
};
// Variables edited on the model, hidden from the form.
const ON_MODEL = new Set([...Object.values(SPATIAL.corners), ...Object.values(SPATIAL.edges), "Screw_Custom_Positions"]);
const syncHandles = () => viewer.syncHandles(handleItems(latestBox));

// 3D handle positions for the current model: corners and edge pills floating outside the board,
// screw rings over each interior intersection. Same variables the generator reads.
// Outlines drawn on the top face, one per toggleable feature:
//  corner  -> the chamfer triangle (the generator cuts a 45° square of side 4.2·√2, i.e. 4.2 mm legs;
//             drawn a little larger so it is easy to hit)
//  edge    -> a strip along the edge where the connector cutouts sit
//  screw   -> a circle around the hole (head diameter 7.2)
function handleItems(box) {
  if (!box) return [];
  const { min, max } = box;
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, z = max.z + 0.15;
  const edgesOn = values.Connector_Holes !== false, cornersOn = values.Chamfers !== "None";
  const LEG = 9, STRIP = 7, R = 5;
  const tri = (id, x, y, sx, sy, label) => ({ id, z, on: !!values[id], enabled: cornersOn, label,
    outline: [[x, y], [x - sx * LEG, y], [x, y - sy * LEG]] });
  const strip = (id, x0, y0, x1, y1, label) => ({ id, z, on: !!values[id], enabled: edgesOn, label,
    outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const circle = (x, y) => Array.from({ length: 24 }, (_, k) => [x + R * Math.cos((k / 24) * 2 * Math.PI), y + R * Math.sin((k / 24) * 2 * Math.PI)]);
  const { cols, rows } = screwGrid();
  const on = screwPattern();
  const screws = [];
  for (let r = 0; r < rows; r++) for (let cI = 0; cI < cols; cI++) {
    const i = r * cols + cI;
    const x = cx - (cols - 1) * 14 + cI * 28, y = cy + (rows - 1) * 14 - r * 28;
    screws.push({ id: `screw:${i}`, z, on: on.has(i), enabled: true, outline: circle(x, y),
      label: `Screw hole (row ${r + 1}, column ${cI + 1})` });
  }
  const inset = 14; // keep edge strips clear of the corner triangles
  return [
    ...screws,
    tri(SPATIAL.corners.TL, min.x, max.y, -1, 1, "Chamfer: top-left corner"),
    tri(SPATIAL.corners.TR, max.x, max.y, 1, 1, "Chamfer: top-right corner"),
    tri(SPATIAL.corners.BL, min.x, min.y, -1, -1, "Chamfer: bottom-left corner"),
    tri(SPATIAL.corners.BR, max.x, min.y, 1, -1, "Chamfer: bottom-right corner"),
    strip(SPATIAL.edges.T, min.x + inset, max.y - STRIP, max.x - inset, max.y, "Connector holes: top edge"),
    strip(SPATIAL.edges.B, min.x + inset, min.y, max.x - inset, min.y + STRIP, "Connector holes: bottom edge"),
    strip(SPATIAL.edges.L, min.x, min.y + inset, min.x + STRIP, max.y - inset, "Connector holes: left edge"),
    strip(SPATIAL.edges.R, max.x - STRIP, min.y + inset, max.x, max.y - inset, "Connector holes: right edge"),
  ];
}

// ---- screw holes ------------------------------------------------------------
// The generator puts screws on interior lattice intersections, (W-1) x (H-1) of them, indexed
// left-to-right, top-to-bottom (see Screw_Mounting == "Custom" in openGrid.scad).
// screwPattern() reproduces which of those each mounting mode fills, so the 3D handles can show
// the current pattern and a click can convert it to an explicit Custom string.
function screwGrid() {
  return { cols: Math.max(0, (values.Board_Width | 0) - 1), rows: Math.max(0, (values.Board_Height | 0) - 1) };
}
function screwPattern() {
  const { cols, rows } = screwGrid();
  const on = new Set();
  const idx = (c, r) => r * cols + c;
  const mode = values.Screw_Mounting;
  if (mode === "Everywhere") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) on.add(idx(c, r));
  } else if (mode === "Corners") {
    if (cols > 0 && rows > 0) for (const c of new Set([0, cols - 1])) for (const r of new Set([0, rows - 1])) on.add(idx(c, r));
  } else if (mode === "By Row and Column") {
    // Mirrors BOSL2 grid_copies(spacing, size) plus the generator's half-tile offset, then snaps to intersections.
    const W = values.Board_Width | 0, H = values.Board_Height | 0;
    const sx = Math.max(1, values.Screw_Every_X_Columns | 0), sy = Math.max(1, values.Screw_Every_X_Rows | 0);
    const offX = ((W - 2) % sx) % 2 === 0 ? 0 : -0.5, offY = ((H - 2) % sy) % 2 === 0 ? 0 : 0.5;
    const nx = Math.floor((W - 2) / sx) + 1, ny = Math.floor((H - 2) / sy) + 1;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = -(nx - 1) * sx / 2 + i * sx + offX; // in tile units from board centre
      const y = -(ny - 1) * sy / 2 + j * sy + offY;
      const c = x + (W - 2) / 2, r = (H - 2) / 2 - y;
      if (Math.abs(c - Math.round(c)) < 1e-6 && Math.abs(r - Math.round(r)) < 1e-6) {
        const ci = Math.round(c), ri = Math.round(r);
        if (ci >= 0 && ci < cols && ri >= 0 && ri < rows) on.add(idx(ci, ri));
      }
    }
  } else if (mode === "Custom") {
    const str = String(values.Screw_Custom_Positions ?? "");
    for (let i = 0; i < Math.min(str.length, cols * rows); i++) if (str[i] === "1") on.add(i);
  }
  return on;
}
function toggleScrew(i) {
  const { cols, rows } = screwGrid();
  const on = screwPattern();
  if (on.has(i)) on.delete(i); else on.add(i);
  const str = Array.from({ length: cols * rows }, (_, k) => (on.has(k) ? "1" : "0")).join("");
  values.Screw_Mounting = "Custom";
  values.Screw_Custom_Positions = str;
}

// ---- parameter form ---------------------------------------------------------
function buildForm() {
  const form = $("params");
  let group = null;
  const hint = (text) => { const el = document.createElement("p"); el.className = "hint"; el.textContent = text; form.appendChild(el); };
  for (const p of params) {
    if (ON_MODEL.has(p.name)) continue; // edited by clicking the model
    if (p.group !== group) {
      group = p.group;
      const h = document.createElement("h2");
      h.textContent = group;
      form.appendChild(h);
      if (group.startsWith("Chamfer")) hint("Click a corner or edge outline on the model to toggle its chamfer or connector holes.");
      if (group.startsWith("Screw")) hint("Click a circle on the model to add or remove a screw hole.");
      if (group.startsWith("Board")) hint("Drag the blue arrows on the model to change the board size.");
    }
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = p.name.replaceAll("_", " ");
    label.htmlFor = p.name;
    field.appendChild(label);

    const set = (v) => { values[p.name] = v; syncHandles(); scheduleRender(); };
    if (p.type === "bool") {
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", id: p.name, checked: p.value });
      cb.onchange = () => set(cb.checked);
      field.appendChild(cb);
    } else if (p.type === "choice") {
      const sel = document.createElement("select");
      sel.id = p.name;
      for (const o of p.options) {
        if (p.name === "Screw_Mounting" && o === "By Row and Column") continue; // needs hidden spacing fields
        sel.appendChild(new Option(String(o), String(o)));
      }
      sel.value = String(p.value);
      sel.onchange = () => set(typeof p.value === "number" ? Number(sel.value) : sel.value);
      setters[p.name] = (v) => { sel.value = String(v); values[p.name] = v; };
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
  clearTimeout(debounce);
  debounce = setTimeout(render, 250);
}

// Rendered STLs keyed by the full parameter set, so revisiting a state (toggling something back,
// undoing a resize) is instant instead of another multi-second render.
const stlCache = new Map();
const CACHE_LIMIT = 40; // ~40 boards × a few hundred KB
// Key on what the geometry depends on, not the raw parameters: screw mode + custom string collapse
// to the effective hole set, and per-corner/edge flags are ignored when their master switch is off.
function cacheKey() {
  const v = { ...values };
  delete v.Screw_Mounting; delete v.Screw_Custom_Positions;
  v.__screws = [...screwPattern()].sort((a, b) => a - b).join(",");
  if (v.Chamfers === "None") for (const n of Object.values(SPATIAL.corners)) delete v[n];
  if (v.Connector_Holes === false) for (const n of Object.values(SPATIAL.edges)) delete v[n];
  if (v.Screw_Every_X_Rows !== undefined) { delete v.Screw_Every_X_Rows; delete v.Screw_Every_X_Columns; }
  return JSON.stringify(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
}
function cachePut(key, stl) {
  if (stlCache.has(key)) stlCache.delete(key);
  stlCache.set(key, stl);
  if (stlCache.size > CACHE_LIMIT) stlCache.delete(stlCache.keys().next().value); // evict oldest
}

// One render in flight at a time; edits made meanwhile collapse into a single follow-up render.
let inFlight = false;
let pending = false;
function render() {
  const key = cacheKey();
  const cached = stlCache.get(key);
  if (cached) {
    cachePut(key, cached); // refresh recency
    pending = false;
    renderId++;
    showResult({ stl: cached, log: ["(from cache)"], ms: 0 });
    return;
  }
  if (inFlight) { pending = true; return; }
  inFlight = true;
  const id = ++renderId;
  setStatus("Rendering…");
  $("spinner").hidden = false;
  $("export").disabled = true;
  worker.postMessage({ id, source, defineArgs: toDefineArgs(values), key });
}

const auxCallbacks = new Map(); // id -> resolve, for non-board renders
let auxId = 0;
function renderAux(src, defineArgs) {
  return new Promise((resolve) => {
    const id = -(++auxId); // negative ids: never collide with board render ids
    auxCallbacks.set(id, resolve);
    worker.postMessage({ id, source: src, defineArgs, key: null });
  });
}

worker.onmessage = ({ data }) => {
  if (auxCallbacks.has(data.id)) { auxCallbacks.get(data.id)(data); auxCallbacks.delete(data.id); return; }
  inFlight = false;
  if (!data.error && data.key) cachePut(data.key, data.stl); // cache even stale results: the user may come back
  if (pending) { pending = false; render(); return; }
  $("spinner").hidden = true;
  if (data.id !== renderId) return; // stale result
  showResult(data);
};

function showResult(data) {
  $("spinner").hidden = true;
  $("log").textContent = data.log.join("\n");
  if (data.error) {
    setStatus(`Render failed: ${data.error}`, true);
    return;
  }
  latestStl = data.stl;
  latestBox = viewer.setStl(latestStl.buffer, { refit: firstRender });
  firstRender = false;
  viewer.setResizeHandles({
    box: latestBox, cols: values.Board_Width | 0, rows: values.Board_Height | 0,
    onResize: (cols, rows) => { values.Board_Width = cols; values.Board_Height = rows; render(); },
  });
  viewer.setHandles(handleItems(latestBox), (id) => {
    if (id.startsWith("screw:")) toggleScrew(Number(id.slice(6)));
    else values[id] = !values[id];
    syncHandles();
    scheduleRender();
  });
  updateStatus(data.ms ? `Rendered in ${(data.ms / 1000).toFixed(1)} s` : "Cached");
  $("export").disabled = false;
  syncConnectorCount();
}

let lastRenderNote = "";
function updateStatus(note) {
  if (note !== undefined) lastRenderNote = note;
  if (!latestBox) return;
  const s = latestBox.max.clone().sub(latestBox.min);
  const [bw, bh, bz] = printer.bed;
  const fits = s.x <= bw && s.y <= bh && s.z <= bz;
  setStatus(`${lastRenderNote} — ${values.Board_Width} × ${values.Board_Height} tiles, ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm — `
    + (fits ? `fits ${printer.name}` : `exceeds ${printer.name} plate (${bw} × ${bh} mm)`), !fits);
}

function setStatus(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

// ---- export to Bambu Studio -------------------------------------------------
$("topview").onclick = () => viewer.viewTop();

// ---- connectors ------------------------------------------------------------
// Connector holes on the current board: the generator cuts (W-1) per horizontal edge and (H-1)
// per vertical edge, on the edges that are enabled.
function connectorHoleCount() {
  if (values.Connector_Holes === false) return 0;
  const W = values.Board_Width | 0, H = values.Board_Height | 0;
  let n = 0;
  if (W > 1) n += (values.Connector_Holes_Top ? W - 1 : 0) + (values.Connector_Holes_Bottom ? W - 1 : 0);
  if (H > 1) n += (values.Connector_Holes_Left ? H - 1 : 0) + (values.Connector_Holes_Right ? H - 1 : 0);
  return n;
}
const countSel = $("connectorCount");
for (let n = 1; n <= 80; n++) countSel.appendChild(new Option(String(n), String(n)));
let countTouched = false;
countSel.onchange = () => { countTouched = true; };
function syncConnectorCount() {
  if (countTouched) return;
  countSel.value = String(Math.min(80, Math.max(1, connectorHoleCount())));
}
syncConnectorCount();

$("printConnectors").onclick = async () => {
  const n = Number(countSel.value);
  const btn = $("printConnectors");
  btn.disabled = true;
  setStatus(`Rendering ${n} connectors…`);
  $("spinner").hidden = false;
  try {
    const data = await renderAux(connectorSource, ["-D", `Count=${n}`]);
    if (data.error) throw new Error(data.error);
    const res = await fetch(`/api/export?name=${encodeURIComponent(`opengrid_connectors_x${n}`)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: data.stl,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    setStatus(`Opened ${n} connectors in Bambu Studio`);
  } catch (err) {
    setStatus(`Connector export failed: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    if (!inFlight) $("spinner").hidden = true;
  }
};

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

buildForm();
fitToPlate();
