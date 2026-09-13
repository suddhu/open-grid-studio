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
| Geometry | `scad/opengrid_tile.scad` | Plain OpenSCAD with Customizer comments. Edit this to change the model. |
| Parameter UI | `src/customizer.js`, `src/main.js` | Parses `/* [Group] */`, `// description`, `// [a, b]`, `// [min:step:max]` and builds the form. |
| Rendering | `src/worker.js` | `@lofcz/openscad-wasm` (Manifold backend) in a Web Worker → binary STL. |
| Preview | `src/viewer.js` | three.js + OrbitControls + STLLoader. |
| Export | `server.mjs` | `POST /api/export` writes `exports/<name>.stl` and runs `open -a BambuStudio <file>`. Set `BAMBU_APP` if your app name differs. |

The cell profile is derived from the mating snap in the official [openGrid-openSCAD](https://github.com/openGrid-3D/openGrid-openSCAD) repo (monokini grip: 25.0 mm tip, 26.4 mm catch at 0.4-1.0 mm depth, 3.4 mm insertion). That repo has no tile generator yet, so this is verified against the snap, not an official tile file.
