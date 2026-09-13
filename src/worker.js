// Renders OpenSCAD source to binary STL off the main thread.
// @lofcz/openscad-wasm tracks upstream openscad-wasm (current OpenSCAD with the Manifold backend).
import createOpenSCAD from "@lofcz/openscad-wasm";

self.onmessage = async ({ data }) => {
  const { id, source, defineArgs } = data;
  const log = [];
  const t0 = performance.now();
  try {
    // A fresh instance per render: Emscripten's main() exits after one run.
    const inst = await createOpenSCAD({
      noInitialRun: true,
      print: (t) => log.push(t),
      printErr: (t) => log.push(t),
    });
    inst.FS.writeFile("/input.scad", source);
    const code = inst.callMain([
      "/input.scad", "--backend=Manifold", "--export-format=binstl",
      ...defineArgs, "-o", "/output.stl",
    ]);
    if (code !== 0) throw new Error(`OpenSCAD exited with code ${code}`);
    const stl = inst.FS.readFile("/output.stl", { encoding: "binary" });
    self.postMessage({ id, stl, log, ms: performance.now() - t0 }, [stl.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err), log, ms: performance.now() - t0 });
  }
};
