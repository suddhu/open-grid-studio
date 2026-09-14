// Renders OpenSCAD source to binary STL off the main thread.
// @lofcz/openscad-wasm tracks upstream openscad-wasm (current OpenSCAD with the Manifold backend).
import createOpenSCAD from "@lofcz/openscad-wasm";

// BOSL2 library, bundled as raw text and written into the wasm filesystem before each render
// so that `include <BOSL2/std.scad>` resolves next to /input.scad.
const BOSL2 = import.meta.glob("../vendor/BOSL2/*.scad", { query: "?raw", import: "default", eager: true });

// Keep one instance alive across renders (noExitRuntime lets main() run repeatedly) so the
// wasm boot cost is paid once. Note OpenSCAD still re-evaluates BOSL2 on every run (~6 s).
// If a run leaves the instance broken, rebuild it.
let instance = null;
let instanceLog = null;

async function getInstance() {
  if (instance) return instance;
  const inst = await createOpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    print: (t) => instanceLog?.push(t),
    printErr: (t) => instanceLog?.push(t),
  });
  inst.FS.mkdir("/BOSL2");
  for (const [path, text] of Object.entries(BOSL2))
    inst.FS.writeFile("/BOSL2/" + path.split("/").pop(), text);
  instance = inst;
  return inst;
}

function runOnce(inst, source, defineArgs) {
  inst.FS.writeFile("/input.scad", source);
  try { inst.FS.unlink("/output.stl"); } catch {}
  const code = inst.callMain([
    "/input.scad", "--backend=Manifold", "--export-format=binstl",
    ...defineArgs, "-o", "/output.stl",
  ]);
  if (code !== 0) throw new Error(`OpenSCAD exited with code ${code}`);
  return inst.FS.readFile("/output.stl", { encoding: "binary" });
}

self.onmessage = async ({ data }) => {
  const { id, source, defineArgs, key } = data;
  const log = (instanceLog = []);
  const t0 = performance.now();
  try {
    let stl;
    try {
      stl = runOnce(await getInstance(), source, defineArgs);
    } catch (err) {
      // A crashed run (abort, exit trap) can poison the instance: rebuild once and retry.
      log.push(`[retrying with a fresh instance: ${err?.message ?? err}]`);
      instance = null;
      stl = runOnce(await getInstance(), source, defineArgs);
    }
    self.postMessage({ id, key, stl, log, ms: performance.now() - t0 }, [stl.buffer]);
  } catch (err) {
    instance = null;
    self.postMessage({ id, key, error: String(err?.message ?? err), log, ms: performance.now() - t0 });
  } finally {
    instanceLog = null;
  }
};
