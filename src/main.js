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
    }
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = p.name.replaceAll("_", " ");
    label.htmlFor = p.name;
    field.appendChild(label);

    const set = (v) => { values[p.name] = v; scheduleRender(); };
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
