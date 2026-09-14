# openGrid Tile Studio

Browser-based parametric generator for openGrid-style boards (28 mm grid; Full 6.8 mm / Lite 4 mm).
OpenSCAD runs in the browser via WebAssembly, the preview is three.js, and one button hands the STL to Bambu Studio.

## Run

```bash
npm install
npm run dev        # → http://localhost:3000
```

## How it works

| Piece | File | Notes |
|---|---|---|
| Geometry | `scad/openGrid.scad` | The **official openGrid tile generator** by BlackjackDuck (the same file behind MakerWorld's Parametric Model Maker), vendored unmodified from [QuackWorks](https://github.com/AndyLevesque/QuackWorks) (commit in `scad/upstream/`). `scad/simple_tile.scad` is an earlier from-scratch version kept for reference. |
| Parameter UI | `src/customizer.js`, `src/main.js` | Parses `/* [Group] */`, `// description`, `// [a, b]`, `// [min:step:max]` and builds the form. |
| Rendering | `src/worker.js` | `@lofcz/openscad-wasm` (Manifold backend) in a Web Worker → binary STL. BOSL2 (`vendor/BOSL2`, BSD-2) is written into the wasm filesystem so `include <BOSL2/std.scad>` resolves. ~7 s per render, dominated by OpenSCAD evaluating BOSL2. |
| Preview | `src/viewer.js` | three.js + OrbitControls + STLLoader. |
| Export | `server.mjs`, `src/threemf.js` | Exports are Bambu 3MF project files: each object carries print settings (layer height, walls, infill, supports) in `Metadata/model_settings.config`, which Bambu Studio applies as object-level overrides. `POST /api/export` writes `exports/<name>.3mf` and runs `open -a BambuStudio <file>`. Filament (PLA) and printer stay on your global selection. |

## Licensing

- `scad/openGrid.scad` — openGrid design by David D, OpenSCAD by BlackjackDuck (Andy Levesque). **CC-BY-NC-SA 4.0**; derived parts CC-BY. Non-commercial use only.
- `vendor/BOSL2` — BSD 2-Clause (Revar Desmera).
- Everything else in this repo (the web app) is original.

To update the generator: copy `openGrid/openGrid.scad` from QuackWorks over `scad/openGrid.scad` and record the commit in `scad/upstream/QuackWorks.commit`. Customizer groups shown in the panel are controlled by `HIDDEN_GROUPS` in `src/main.js`.

## Multiconnect parts

`scad/parts/` holds BlackjackDuck's Multiconnect part generators (Hook, Item Holder, Shelf) from
QuackWorks `VerticalMountingSeries/`, rendered with `Connection_Type = "Multiconnect - openGrid"`.
Parts are placed on cells in the 3D view (click a palette button, then a cell; drag to move; Delete
to remove) and persisted in localStorage. "Print parts" packs every placed part plus one official
openGrid Multiconnect Snap per slot (`parts/snaps/`, from David D's Printables release) onto plates
sized for the selected printer and opens each in Bambu Studio. Placement geometry: `src/parts.js`.
