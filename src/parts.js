// Multiconnect parts catalogue and placement geometry.
// Part generators are BlackjackDuck's (QuackWorks, CC-BY-NC-SA); each is rendered with
// Connection_Type = "Multiconnect - openGrid" so its slots sit on the 28 mm grid.
import * as THREE from "three";
import hookSrc from "../scad/parts/MulticonnectHook.scad?raw";
import holderSrc from "../scad/parts/VerticalItemHolder.scad?raw";
import shelfSrc from "../scad/parts/MulticonnectShelf.scad?raw";
import binSrc from "../scad/parts/MulticonnectBin.scad?raw";
import roundHolderSrc from "../scad/parts/MultiConnectRoundSingleHolder.scad?raw";
import roundRowSrc from "../scad/parts/MultiConnectRoundRow.scad?raw";
import roundHookSrc from "../scad/parts/MultiConnectRoundHook.scad?raw";
import spoolSrc from "../scad/parts/SpoolHolder.scad?raw";

export const PITCH = 28;
export const SLOT_STOP = 13; // Multiconnect_Stop_Distance_From_Back: snap centre sits 13 mm below the plate top

export const PART_TYPES = {
  hook:        { name: "Hook",         source: hookSrc },
  holder:      { name: "Item Holder",  source: holderSrc },
  shelf:       { name: "Shelf",        source: shelfSrc },
  bin:         { name: "Bin",          source: binSrc },
  roundHolder: { name: "Round Holder", source: roundHolderSrc },
  roundRow:    { name: "Round Row",    source: roundRowSrc },
  // Round Hook predates the openGrid option; its slot spacing is a plain variable we override to 28.
  // Its default edge rounding (r = 2.3) uses minkowski() and crashes CGAL in wasm; r = 1 renders fine.
  roundHook:   { name: "Round Hook",   source: roundHookSrc, forced: { distanceBetweenSlots: 28 }, defaults: { r: 1 } },
  spool:       { name: "Spool Holder", source: spoolSrc }, // ours: peg for filament spools (see the file header)
};
// Customizer groups the panel hides for parts (mounting is forced to openGrid; slot tuning is fine detail)
export const PART_HIDDEN_GROUPS = new Set(["Mounting Parameters", "Mounting Surface", "Slot Types", "Slot Customization",
  "GOEWS Customization", "Performance", "Hidden", "Advanced"]);
export const PART_FORCED = { Connection_Type: "Multiconnect - openGrid" };

// All generators share one frame: x centred on the part, back plate at y ∈ [-t, 0] (the board is
// at -y), z = up the wall. World frame: board face on z = top, +y = up the wall.
//   world = (-x_p, z_p, y_p)  — a proper rotation (X +90°, then Z 180°).
export const PART_ROTATION = new THREE.Matrix4().makeRotationZ(Math.PI).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

// Slots are centred on the plate, spaced PITCH, floor(width / PITCH) of them.
export function slotCount(box) {
  return Math.max(1, Math.floor((box.max.x - box.min.x + 0.01) / PITCH));
}

// Cell (c, r) centre on a W x H board centred at the origin; row 0 is the top (+y).
export function cellCenter(c, r, W, H) {
  return [-W * PITCH / 2 + PITCH / 2 + c * PITCH, H * PITCH / 2 - PITCH / 2 - r * PITCH];
}

// Placement of a part whose leftmost slot goes on cell (c, r).
// Returns { matrix, snapCells, cells (occupied), inBounds }.
export function placePart(box, c, r, W, H, top) {
  const n = slotCount(box);
  const cx = (box.min.x + box.max.x) / 2;
  const [ax, ay] = cellCenter(c, r, W, H);
  const x0 = ax + (n - 1) / 2 * PITCH + cx;
  const y0 = ay - (box.max.z - SLOT_STOP);
  const z0 = top - box.min.y;
  const matrix = new THREE.Matrix4().makeTranslation(x0, y0, z0).multiply(PART_ROTATION);
  const snapCells = Array.from({ length: n }, (_, k) => [c + k, r]);
  // Cells whose centres fall under the part's footprint (world XY), plus the snap cells
  const wx0 = x0 - box.max.x, wx1 = x0 - box.min.x, wy0 = y0 + box.min.z, wy1 = y0 + box.max.z;
  const cells = new Set(snapCells.map(([cc, rr]) => `${cc},${rr}`));
  for (let cc = 0; cc < W; cc++) for (let rr = 0; rr < H; rr++) {
    const [px, py] = cellCenter(cc, rr, W, H);
    if (px > wx0 && px < wx1 && py > wy0 && py < wy1) cells.add(`${cc},${rr}`);
  }
  const inBounds = snapCells.every(([cc, rr]) => cc >= 0 && cc < W && rr >= 0 && rr < H);
  return { matrix, snapCells, cells, inBounds, n };
}

export function cellAt(x, y, W, H) {
  const c = Math.floor((x + W * PITCH / 2) / PITCH), r = Math.floor((H * PITCH / 2 - y) / PITCH);
  return [c, r];
}

// Pack print items onto plates. items: [{ pos, box }] in their own print frame (z up).
// Returns [[{ pos, matrix }...], ...] one array per plate.
export function packPlates(items, bed, gap = 5) {
  const [bw, bh] = bed;
  const sorted = [...items].sort((a, b) => (b.box.max.y - b.box.min.y) - (a.box.max.y - a.box.min.y));
  const plates = [];
  let plate = [], x = 0, y = 0, rowH = 0;
  const newPlate = () => { if (plate.length) plates.push(plate); plate = []; x = 0; y = 0; rowH = 0; };
  for (const it of sorted) {
    const w = it.box.max.x - it.box.min.x, h = it.box.max.y - it.box.min.y;
    if (x + w > bw) { x = 0; y += rowH + gap; rowH = 0; }
    if (y + h > bh) newPlate();
    const m = new THREE.Matrix4().makeTranslation(x - it.box.min.x - bw / 2, y - it.box.min.y - bh / 2, -it.box.min.z);
    plate.push({ pos: it.pos, matrix: m });
    x += w + gap; rowH = Math.max(rowH, h);
  }
  newPlate();
  return plates;
}
