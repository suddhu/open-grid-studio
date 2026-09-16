import * as THREE from "three";
import { parseCustomizer, toDefineArgs } from "./customizer.js";
import { createViewer } from "./viewer.js";
import { PRINTERS } from "./printers.js";
import source from "../scad/openGrid.scad?raw";
import connectorSource from "../scad/connector.scad?raw";
import { PART_TYPES, PART_HIDDEN_GROUPS, PART_FORCED, PRINT_DEFAULTS, PRINT_BOARD, PRINT_SNAP, PRINT_CONNECTOR, PITCH, placePart, slotCount, cellAt, cellCenter, packPlates, transformed } from "./parts.js";
import { toArrayBuffer } from "./stl.js";
import { write3mf } from "./threemf.js";
import snapUrl from "../parts/snaps/mc_snap.stl?url";
import connectorUrl from "../parts/snaps/mc_connector.stl?url";

// Board options are fixed (Full tile, corner chamfers, connector holes on every edge, 4 corner
// screw holes); the panel only shows what is left. Everything else keeps the generator's defaults.
const FORCED = { Full_or_Lite: "Full", Connector_Holes: true, Chamfers: "Corners", Screw_Mounting: "Corners" };
const HIDDEN_GROUPS = new Set(["Advanced - Tile Parameters", "Tile Stacking", "Beta - Fill Space", "Adhesive Base Options", "Chamfer and Connector Options", "Screw Options"]);
const HIDDEN_PARAMS = new Set(["Board_Width", "Board_Height"]); // edited on the model (drag arrows)

const $ = (id) => document.getElementById(id);
function boardWH() { return [values.Board_Width | 0, values.Board_Height | 0]; }
function boardTop() { return latestBox ? latestBox.max.z : 0; }
const viewer = createViewer($("viewer"));
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

const allParams = parseCustomizer(source).filter((p) => !HIDDEN_GROUPS.has(p.group) || p.name in FORCED);
const params = allParams.filter((p) => !HIDDEN_PARAMS.has(p.name) && !(p.name in FORCED)); // shown in the form
const values = Object.assign(Object.fromEntries(allParams.map((p) => [p.name, p.value])), FORCED);
window.__values = values; window.__viewer = viewer; // debugging aids for the console
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

// ---- colours ---------------------------------------------------------------
// Two colours from the seaborn "colorblind" palette: blue for the board, orange for everything
// that mounts on it (parts, snaps, placement ghost — see viewer.js PART_COLOR).
const BOARD_COLOR = "#0173b2";
viewer.setColor(BOARD_COLOR);

// ---- generic Customizer field ------------------------------------------------
// Builds one control for param p, reading/writing vals[p.name]; returns { el, set }.
function createField(p, vals, onChange) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = p.name.replaceAll("_", " ");
  field.appendChild(label);
  const set = (v) => { vals[p.name] = v; onChange(p.name, v); };
  let setter;
  if (p.type === "bool") {
    const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!vals[p.name] });
    cb.onchange = () => set(cb.checked);
    field.appendChild(cb);
    setter = (v) => { cb.checked = !!v; vals[p.name] = v; };
  } else if (p.type === "choice") {
    const sel = document.createElement("select");
    for (const o of p.options) sel.appendChild(new Option(String(o), String(o)));
    sel.value = String(vals[p.name]);
    sel.onchange = () => set(typeof p.value === "number" ? Number(sel.value) : sel.value);
    field.appendChild(sel);
    setter = (v) => { sel.value = String(v); vals[p.name] = v; };
  } else if (p.type === "range" || p.type === "number") {
    // Plain numbers get a slider too: 0 .. 3x the default (at least 10), step by the default's precision
    const v0 = Number(p.value) || 0;
    const isInt = Number.isInteger(v0);
    const min = p.type === "range" ? p.min : 0;
    const max = p.type === "range" ? p.max : Math.max(10, Math.ceil(v0 * 3));
    const step = p.type === "range" ? p.step : isInt ? 1 : 0.1;
    const num = Object.assign(document.createElement("input"), { type: "number", min, max, step, value: vals[p.name] });
    const range = Object.assign(document.createElement("input"), { type: "range", min, max, step, value: vals[p.name] });
    num.onchange = () => { range.value = num.value; set(Number(num.value)); };
    range.oninput = () => { num.value = range.value; };
    range.onchange = () => set(Number(range.value));
    field.appendChild(num);
    const wrap = document.createElement("div"); wrap.className = "range"; wrap.appendChild(range); field.appendChild(wrap);
    setter = (v) => { num.value = v; range.value = v; vals[p.name] = v; };
  } else {
    const inp = Object.assign(document.createElement("input"), { type: p.type === "number" ? "number" : "text", value: vals[p.name] });
    inp.onchange = () => set(p.type === "number" ? Number(inp.value) : inp.value);
    field.appendChild(inp);
    setter = (v) => { inp.value = v; vals[p.name] = v; };
  }
  if (p.description) { const d = document.createElement("small"); d.textContent = p.description; field.appendChild(d); }
  return { el: field, set: setter };
}

// ---- parameter form ---------------------------------------------------------
function buildForm() {
  const form = $("params");
  let group = null;
  for (const p of params) {
    if (p.group !== group) {
      group = p.group;
      const h = document.createElement("h2");
      h.textContent = group;
      form.appendChild(h);
      if (group.startsWith("Board")) {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = "Drag the blue arrows on the model to change the board size.";
        form.appendChild(hint);
      }
    }
    form.appendChild(createField(p, values, scheduleRender).el);
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
const cacheKey = () => stableKey(values);
const stableKey = (obj) => JSON.stringify(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
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
  updateStatus(data.ms ? `Rendered in ${(data.ms / 1000).toFixed(1)} s` : "Cached");
  $("export").disabled = false;
  syncConnectorCount();
  refreshParts();
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
let topView = false;
$("topview").onclick = () => {
  topView = !topView;
  if (topView) viewer.viewTop(); else viewer.viewIso();
  $("topview").textContent = topView ? "Iso view" : "Top view";
};

// ---- measure tool -----------------------------------------------------------
let measuring = false;
function setMeasuring(v) {
  measuring = v;
  $("measure").classList.toggle("active", v);
  $("measureUnit").hidden = !v;
  viewer.setMeasuring(v, $("measureUnit").value);
  if (v) { startPlacing(null); setStatus("Measure: click two points (snaps to edges/corners). Esc clears."); }
}
$("measure").onclick = () => setMeasuring(!measuring);
$("measureUnit").onchange = () => viewer.setMeasuring(measuring, $("measureUnit").value);

// ---- connectors ------------------------------------------------------------
// Connector holes on the current board: the generator cuts (W-1) per horizontal edge and (H-1)
// per vertical edge, on all four edges.
function connectorHoleCount() {
  const [W, H] = boardWH();
  return 2 * Math.max(0, W - 1) + 2 * Math.max(0, H - 1);
}
const countSel = $("connectorCount");
countSel.append(...Array.from({ length: 80 }, (_, i) => new Option(String(i + 1), String(i + 1))));
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
    const r = await sendToBambu(`opengrid_connectors_x${n}`, [{ name: `openGrid connectors ×${n}`, pos: meshData(toArrayBuffer(data.stl)).pos, settings: PRINT_CONNECTOR }]);
    setStatus(exportNote(r, `${n} connectors`));
  } catch (err) {
    setStatus(`Connector export failed: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    if (!inFlight) $("spinner").hidden = true;
  }
};

// Build a Bambu 3MF (objects carry their print settings) and hand it to Bambu Studio.
// With the local dev server, /api/export opens it in Bambu Studio directly; on a static host
// (GitHub Pages) there is no server, so the file is downloaded instead.
let localServer = null; // null = unknown, then true/false
async function sendToBambu(name, objects) {
  const file = await write3mf(objects);
  if (localServer !== false) {
    try {
      const res = await fetch(`/api/export?name=${encodeURIComponent(name)}&ext=3mf`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        localServer = true;
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        return { opened: true, path: body.path };
      }
      localServer = false; // static host answered (404 page, not our API)
    } catch (err) {
      if (localServer === true) throw err; // a real server error
      localServer = false;
    }
  }
  const url = URL.createObjectURL(new Blob([file], { type: "model/3mf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.3mf` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { opened: false, path: `${name}.3mf` };
}
const exportNote = (r, what) => (r.opened ? `Opened ${what} in Bambu Studio` : `Downloaded ${r.path} — open it in Bambu Studio`);

$("export").onclick = async () => {
  if (!latestStl) return;
  const [W, H] = boardWH();
  setStatus("Sending board to Bambu Studio…");
  try {
    const r = await sendToBambu(`opengrid_board_${W}x${H}`, [{ name: `openGrid board ${W}×${H}`, pos: meshData(toArrayBuffer(latestStl)).pos, settings: PRINT_BOARD }]);
    setStatus(exportNote(r, "the board"));
  } catch (err) {
    setStatus(`Export failed: ${err.message}`, true);
  }
};

buildForm();
fitToPlate();


// =============================================================================
// Multiconnect parts on the board
// =============================================================================
const PARTS_KEY = "opengrid.parts";
const partDefs = Object.fromEntries(Object.entries(PART_TYPES).map(([id, t]) => {
  const all = parseCustomizer(t.source);
  const defaults = Object.fromEntries(all.map((p) => [p.name, p.value]));
  const forced = { ...PART_FORCED, ...(t.forced || {}) };
  // Only force what the file actually declares (e.g. Round Hook has no Connection_Type)
  for (const k of Object.keys(forced)) if (k in defaults) defaults[k] = forced[k];
  Object.assign(defaults, t.defaults || {}); // editable default overrides
  return [id, { ...t, params: all.filter((p) => !PART_HIDDEN_GROUPS.has(p.group) && !(p.name in forced)), defaults, forced }];
}));

let placed = [];          // [{ id, type, cell: [c, r], params }]
let selectedId = null;
let placingType = null;   // part type being placed, or null
let nextPartId = 1;
const partGeo = new Map(); // key -> { pos, box, geometry } (rendered part, in its own frame)
const partPending = new Map();
let snapGeo = null;      // official Multiconnect snap (threaded socket that clips into a cell)
let connectorGeo = null; // official Multiconnect connector (threaded stud with the 20 mm head the parts hang on)

try {
  const saved = JSON.parse(localStorage.getItem(PARTS_KEY) || "[]");
  placed = saved.filter((p) => partDefs[p.type]).map((p) => {
    const def = partDefs[p.type];
    const forced = Object.fromEntries(Object.entries(def.forced).filter(([k]) => k in def.defaults));
    return { ...p, id: nextPartId++, params: { ...def.defaults, ...p.params, ...forced } }; // forced keys always win
  });
} catch {}
const savePlaced = () => { try { localStorage.setItem(PARTS_KEY, JSON.stringify(placed.map(({ type, cell, params }) => ({ type, cell, params })))); } catch {} };

const partKey = (type, params) => type + "|" + stableKey(params);

// Render (or fetch from cache) a part's geometry; resolves { pos, box, geometry }.
// Note: `pos` is derived from the STLLoader geometry (non-indexed triangle soup).
function ensurePartGeo(type, params) {
  const key = partKey(type, params);
  if (partGeo.has(key)) return Promise.resolve(partGeo.get(key));
  if (partPending.has(key)) return partPending.get(key);
  const pr = renderAux(partDefs[type].source, toDefineArgs(params)).then((data) => {
    if (data.error) throw new Error(data.error);
    const g = meshData(toArrayBuffer(data.stl));
    partGeo.set(key, g);
    return g;
  }).finally(() => partPending.delete(key)); // a failure is retried next time, not cached
  partPending.set(key, pr);
  return pr;
}
// { pos (flat triangle soup), box, geometry } from a binary STL buffer — one parse, shared by the
// viewer (geometry) and the plate packer (pos/box).
function meshData(buffer) {
  const geometry = viewer.geometryFromStl(buffer);
  geometry.computeBoundingBox();
  return { pos: geometry.attributes.position.array, box: geometry.boundingBox, geometry };
}
async function loadSnaps() {
  [snapGeo, connectorGeo] = await Promise.all([snapUrl, connectorUrl].map((u) => fetch(u).then((r) => r.arrayBuffer()).then(meshData)));
}

// Snap sits inside the cell, flush with the face (6.8 deep). The connector screws into it stem-down;
// its STL has the head face at z = 0, so flip it and stand the head 3.5 mm (neck + head) above the face.
function snapMatrix(c, r) {
  const [x, y] = cellCenter(c, r, ...boardWH());
  const size = snapGeo.box.getSize(new THREE.Vector3());
  return new THREE.Matrix4().makeTranslation(x - size.x / 2, y - size.y / 2, boardTop() - size.z);
}
function connectorMatrix(c, r) {
  const [x, y] = cellCenter(c, r, ...boardWH());
  const size = connectorGeo.box.getSize(new THREE.Vector3());
  return new THREE.Matrix4().makeTranslation(x, y, boardTop() + 3.5)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-size.x / 2, -size.y / 2, 0));
}

function occupiedBy(excludeId) {
  const occ = new Map();
  for (const p of placed) {
    if (p.id === excludeId) continue;
    const g = partGeo.get(partKey(p.type, p.params));
    if (!g) continue;
    const { cells } = placePart(g.box, p.cell[0], p.cell[1], ...boardWH(), boardTop());
    for (const k of cells) occ.set(k, p.id);
  }
  return occ;
}
function placementValid(box, c, r, excludeId) {
  const [W, H] = boardWH();
  const pl = placePart(box, c, r, W, H, boardTop());
  if (!pl.inBounds) return { ...pl, valid: false };
  const occ = occupiedBy(excludeId);
  const valid = [...pl.cells].every((k) => !occ.has(k));
  return { ...pl, valid };
}

let refreshSeq = 0;
async function refreshParts() {
  if (!latestBox) return;
  const seq = ++refreshSeq;
  const snapshot = [...placed];
  const geos = await Promise.all(snapshot.map((p) => ensurePartGeo(p.type, p.params).catch((err) => {
    setStatus(`${partDefs[p.type].name} failed: ${err.message}`, true);
    return null;
  })));
  if (seq !== refreshSeq) return; // a newer refresh started while we were rendering; it will draw
  const [W, H] = boardWH();
  const list = [];
  const dropped = [];
  snapshot.forEach((p, i) => {
    const g = geos[i];
    if (!g) return;
    const pl = placePart(g.box, p.cell[0], p.cell[1], W, H, boardTop());
    if (!pl.inBounds) { dropped.push(p); return; } // board shrank (or stale storage): part no longer fits
    list.push({ id: p.id, geometry: g.geometry, matrix: pl.matrix, selected: p.id === selectedId,
      snaps: snapGeo ? pl.snapCells.map(([c, r]) => snapMatrix(c, r)) : [], snapGeometry: snapGeo?.geometry,
      connectors: connectorGeo ? pl.snapCells.map(([c, r]) => connectorMatrix(c, r)) : [], connectorGeometry: connectorGeo?.geometry });
  });
  if (dropped.length) {
    placed = placed.filter((p) => !dropped.includes(p));
    if (dropped.some((p) => p.id === selectedId)) selectedId = null;
    savePlaced();
    setStatus(`Removed ${dropped.length} part${dropped.length > 1 ? "s" : ""} that no longer fit on the board`, true);
  }
  viewer.setParts(list);
  renderPartList();
}

// ---- panel ------------------------------------------------------------------
const palette = $("partPalette");
const THUMB_KEY = "opengrid.thumbs";
let thumbs = {};
try { thumbs = JSON.parse(localStorage.getItem(THUMB_KEY) || "{}"); } catch {}
for (const [type, def] of Object.entries(partDefs)) {
  const b = document.createElement("button");
  b.type = "button";
  b.title = def.name;
  const icon = document.createElement(thumbs[type] ? "img" : "div");
  if (thumbs[type]) { icon.src = thumbs[type]; icon.alt = ""; } else icon.className = "ph";
  const label = document.createElement("span");
  label.textContent = def.name;
  b.append(icon, label);
  b.onclick = () => startPlacing(placingType === type ? null : type);
  b.dataset.type = type;
  palette.appendChild(b);
}
// Render missing thumbnails in the background (one part at a time, after the board is up).
async function buildThumbnails() {
  for (const [type, def] of Object.entries(partDefs)) {
    if (thumbs[type]) continue;
    try {
      const g = await ensurePartGeo(type, def.defaults);
      thumbs[type] = viewer.renderThumbnail(g.geometry);
      const b = palette.querySelector(`[data-type="${type}"]`);
      const img = document.createElement("img"); img.src = thumbs[type]; img.alt = "";
      b.replaceChild(img, b.firstChild);
      try { localStorage.setItem(THUMB_KEY, JSON.stringify(thumbs)); } catch {}
    } catch (err) { console.warn("thumbnail failed", type, err); }
  }
}
function startPlacing(type) {
  placingType = type;
  for (const b of palette.children) b.classList.toggle("active", b.dataset.type === type);
  viewer.setPlacing(!!type);
  if (type) { selectPart(null); ensurePartGeo(type, partDefs[type].defaults).catch(() => {}); setStatus(`Click a cell to place the ${partDefs[type].name} (Esc to cancel)`); }
}
function renderPartList() {
  const ul = $("partList");
  ul.innerHTML = "";
  for (const p of placed) {
    const li = document.createElement("li");
    li.className = p.id === selectedId ? "selected" : "";
    li.innerHTML = `<span>${partDefs[p.type].name}</span><span class="cell">col ${p.cell[0] + 1}, row ${p.cell[1] + 1}</span>`;
    li.onclick = () => selectPart(p.id);
    ul.appendChild(li);
  }
  const n = placed.length;
  const snaps = placed.reduce((s, p) => { const g = partGeo.get(partKey(p.type, p.params)); return s + (g ? slotCount(g.box) : 1); }, 0);
  $("partsSummary").textContent = n ? `${n} part${n > 1 ? "s" : ""}, ${snaps} snap${snaps !== 1 ? "s" : ""} + connector${snaps !== 1 ? "s" : ""}` : "no parts placed";
  $("printParts").disabled = n === 0;
}
function selectPart(id) {
  selectedId = id;
  const ed = $("partEditor");
  const p = placed.find((x) => x.id === id);
  ed.hidden = !p;
  if (p) {
    $("partEditorName").textContent = partDefs[p.type].name;
    const form = $("partParams");
    form.innerHTML = "";
    let group = null;
    for (const prm of partDefs[p.type].params) {
      if (prm.group !== group) { group = prm.group; const h = document.createElement("h2"); h.textContent = group; form.appendChild(h); }
      form.appendChild(createField(prm, p.params, () => { savePlaced(); refreshParts(); }).el);
    }
  }
  refreshParts();
}
$("deletePart").onclick = () => {
  placed = placed.filter((p) => p.id !== selectedId);
  savePlaced();
  selectPart(null);
};
document.addEventListener("keydown", (ev) => {
  if (ev.target.matches("input, select, textarea")) return;
  if (ev.key === "Escape") { if (measuring) viewer.clearMeasure(); startPlacing(null); }
  if ((ev.key === "Delete" || ev.key === "Backspace") && selectedId != null) $("deletePart").onclick();
});

// ---- placement / dragging on the board ---------------------------------------
function ghostFor(type, params, c, r, excludeId) {
  const g = partGeo.get(partKey(type, params));
  const [W, H] = boardWH();
  if (!g) { // geometry still rendering: show the anchor cell only
    const [x, y] = cellCenter(c, r, W, H);
    viewer.setGhost([[x, y, PITCH, PITCH, boardTop()]], c >= 0 && c < W && r >= 0 && r < H);
    return null;
  }
  const pl = placementValid(g.box, c, r, excludeId);
  const rects = [...pl.cells].map((k) => { const [cc, rr] = k.split(",").map(Number); const [x, y] = cellCenter(cc, rr, W, H); return [x, y, PITCH, PITCH, boardTop()]; });
  viewer.setGhost(rects, pl.valid, g.geometry, pl.matrix);
  return pl;
}
viewer.on("placemove", (ev) => {
  const pt = viewer.boardPoint(ev, boardTop());
  if (!pt || !placingType) return;
  const [c, r] = cellAt(pt[0], pt[1], ...boardWH());
  ghostFor(placingType, partDefs[placingType].defaults, c, r, null);
});
viewer.on("placeclick", async (ev) => {
  const pt = viewer.boardPoint(ev, boardTop());
  if (!pt || !placingType) return;
  const type = placingType;
  const [c, r] = cellAt(pt[0], pt[1], ...boardWH());
  let g;
  try { g = await ensurePartGeo(type, partDefs[type].defaults); }
  catch (err) { setStatus(`${partDefs[type].name} failed to render: ${err.message}`, true); return; }
  if (placingType !== type) return; // cancelled (Esc) or switched part while rendering
  const pl = placementValid(g.box, c, r, null);
  if (!pl.valid) { setStatus("That spot is off the board or already occupied", true); return; }
  const part = { id: nextPartId++, type, cell: [c, r], params: { ...partDefs[type].defaults } };
  placed.push(part);
  savePlaced();
  startPlacing(null);
  selectPart(part.id);
  setStatus(`Placed ${partDefs[type].name} at column ${c + 1}, row ${r + 1}`);
});
let dragTarget = null;
let dragOffset = null; // grabbed cell minus the part's anchor cell, so the part moves with the pointer
viewer.on("partdragstart", (id, ev) => {
  const p = placed.find((x) => x.id === id);
  const pt = viewer.boardPoint(ev, boardTop());
  if (!p || !pt) return;
  const [c, r] = cellAt(pt[0], pt[1], ...boardWH());
  dragOffset = [c - p.cell[0], r - p.cell[1]];
});
viewer.on("partdrag", (id, ev) => {
  const p = placed.find((x) => x.id === id);
  const pt = viewer.boardPoint(ev, boardTop());
  if (!p || !pt || !dragOffset) return;
  const [c, r] = cellAt(pt[0], pt[1], ...boardWH());
  dragTarget = [c - dragOffset[0], r - dragOffset[1]];
  ghostFor(p.type, p.params, dragTarget[0], dragTarget[1], id);
});
viewer.on("partdrop", (id) => {
  const p = placed.find((x) => x.id === id);
  viewer.clearGhost();
  const target = dragTarget;
  dragTarget = dragOffset = null;
  if (!p || !target) return;
  const g = partGeo.get(partKey(p.type, p.params));
  const pl = g ? placementValid(g.box, target[0], target[1], id) : null;
  if (pl?.valid) { p.cell = target; savePlaced(); }
  selectPart(id);
});
viewer.on("partclick", (id) => { dragOffset = null; selectPart(id); });
viewer.on("emptyclick", () => { if (selectedId != null) selectPart(null); });

// ---- print parts --------------------------------------------------------------
$("printParts").onclick = async () => {
  const btn = $("printParts");
  if (!snapGeo || !connectorGeo) { setStatus("Snap/connector models are still loading — try again in a moment", true); return; }
  btn.disabled = true;
  setStatus("Preparing parts plate…");
  try {
    const geos = await Promise.all(placed.map((p) => ensurePartGeo(p.type, p.params)));
    // Parts print in their modelled orientation unless the catalogue gives a print rotation
    const items = geos.map((g, i) => {
      const def = partDefs[placed[i].type];
      const m = def.printRotation ? transformed(g.pos, def.printRotation) : { pos: g.pos, box: g.box };
      return { ...m, name: def.name, settings: { ...PRINT_DEFAULTS, ...(def.print || {}) } };
    });
    const snaps = geos.reduce((n, g) => n + slotCount(g.box), 0);
    for (let i = 0; i < snaps; i++) {
      items.push({ pos: snapGeo.pos, box: snapGeo.box, name: "Multiconnect snap", settings: PRINT_SNAP });
      items.push({ pos: connectorGeo.pos, box: connectorGeo.box, name: "Multiconnect connector", settings: PRINT_SNAP });
    }
    const plates = packPlates(items, printer.bed);
    let r;
    for (let i = 0; i < plates.length; i++) {
      const objects = plates[i].map((it) => ({ name: it.name, settings: it.settings, pos: transformed(it.pos, it.matrix).pos }));
      r = await sendToBambu(`opengrid_parts${plates.length > 1 ? `_plate${i + 1}` : ""}`, objects);
    }
    setStatus(exportNote(r, `${placed.length} part${placed.length > 1 ? "s" : ""} + ${snaps} snap${snaps !== 1 ? "s" : ""} + ${snaps} connector${snaps !== 1 ? "s" : ""} (${plates.length} plate${plates.length > 1 ? "s" : ""})`));
  } catch (err) {
    setStatus(`Parts export failed: ${err.message}`, true);
  } finally {
    btn.disabled = placed.length === 0;
  }
};

loadSnaps().then(refreshParts).then(buildThumbnails);
