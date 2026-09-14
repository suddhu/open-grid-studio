// Minimal 3MF writer with Bambu Studio per-object print settings.
// objects: [{ name, pos: Float32Array (triangle soup, already in print position), settings: {key: value} }]
// Settings go into Metadata/model_settings.config, which Bambu Studio reads as object-level overrides
// (wall_loops, sparse_infill_density, sparse_infill_pattern, layer_height, enable_support, ...).
import JSZip from "jszip";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function meshXml(pos) {
  // Index the triangle soup: 3MF wants a vertex list + index triples
  const verts = [], tris = [], index = new Map();
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`;
    let vi = index.get(key);
    if (vi === undefined) { vi = verts.length; verts.push(key); index.set(key, vi); }
    tris.push(vi);
  }
  const v = verts.map((k) => { const [x, y, z] = k.split(","); return `<vertex x="${x}" y="${y}" z="${z}"/>`; }).join("");
  let t = "";
  for (let i = 0; i < tris.length; i += 3) t += `<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`;
  return `<mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh>`;
}

export async function write3mf(objects) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="config" ContentType="text/xml"/></Types>`);
  zip.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);

  const objXml = objects.map((o, i) => `<object id="${i + 1}" name="${esc(o.name)}" type="model">${meshXml(o.pos)}</object>`).join("");
  const items = objects.map((_, i) => `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`).join("");
  zip.file("3D/3dmodel.model",
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">openGrid Tile Studio</metadata>` +
    `<resources>${objXml}</resources><build>${items}</build></model>`);

  // Bambu Studio object settings
  const cfg = objects.map((o, i) => {
    const meta = Object.entries({ name: o.name, ...o.settings }).map(([k, v]) => `<metadata key="${esc(k)}" value="${esc(v)}"/>`).join("");
    return `<object id="${i + 1}">${meta}<part id="${i + 1}" subtype="normal_part"><metadata key="name" value="${esc(o.name)}"/></part></object>`;
  }).join("");
  zip.file("Metadata/model_settings.config", `<?xml version="1.0" encoding="UTF-8"?>\n<config>${cfg}</config>`);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
