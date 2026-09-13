// Parses OpenSCAD Customizer syntax into a parameter list.
//   /* [Group] */                      -> group header
//   // description                     -> description for the next variable
//   Name = value; // [a, b] | [min:step:max] | [min:max]
// Stops at /* [Hidden] */. Only top-level assignments before the first module are read.
export function parseCustomizer(source) {
  const params = [];
  let group = "Parameters";
  let pendingDesc = "";
  let pendingDesc0 = "";
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const g = line.match(/^\/\*\s*\[(.+?)\]\s*\*\/$/);
    if (g) { group = g[1]; pendingDesc = ""; if (group === "Hidden") break; continue; }
    if (line.startsWith("//")) { pendingDesc = line.replace(/^\/\/\s?/, ""); continue; }
    if (/^(module|function)\b/.test(line)) break;
    const m = line.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+?);\s*(?:\/\/\s*(.*))?$/);
    if (!m) { if (line !== "") pendingDesc = ""; continue; }
    const [, name, rawValue, annotation = ""] = m;
    pendingDesc0 = pendingDesc; pendingDesc = "";
    if (name === "$fn") continue; // keep as a code-level constant
    // Like OpenSCAD's Customizer, only literal values are parameters; computed assignments are not.
    if (!/^(true|false|-?\d+(\.\d+)?|"[^"]*")$/.test(rawValue.trim())) continue;
    pendingDesc = pendingDesc0;
    const p = { name, group, description: pendingDesc, value: parseValue(rawValue) };
    pendingDesc = "";
    const ann = annotation.trim().match(/^\[(.*)\]$/);
    if (typeof p.value === "boolean") p.type = "bool";
    else if (ann) {
      const body = ann[1];
      if (body.includes(":") && !body.includes(",")) {
        const parts = body.split(":").map(Number);
        p.type = "range";
        if (parts.length === 3) [p.min, p.step, p.max] = parts;
        else { [p.min, p.max] = parts; p.step = Number.isInteger(p.value) ? 1 : 0.1; }
      } else {
        p.type = "choice";
        p.options = body.split(",").map((s) => parseValue(s.trim()));
      }
    } else p.type = typeof p.value === "number" ? "number" : "string";
    params.push(p);
  }
  return params;
}

function parseValue(s) {
  if (s === "true") return true;
  if (s === "false") return false;
  const q = s.match(/^"(.*)"$/);
  if (q) return q[1];
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

// Turns {name: value} into OpenSCAD -D arguments.
export function toDefineArgs(values) {
  return Object.entries(values).flatMap(([k, v]) => [
    "-D",
    `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`,
  ]);
}
