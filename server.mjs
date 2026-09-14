// Dev server: Vite (frontend) + one API route that hands an STL to Bambu Studio.
import express from "express";
import { createServer as createViteServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";

const PORT = 3000;
const EXPORT_DIR = path.resolve("exports");
const BAMBU_APP = process.env.BAMBU_APP || "BambuStudio";

const app = express();

app.post("/api/export", express.raw({ type: "*/*", limit: "200mb" }), async (req, res) => {
  const name = String(req.query.name || "model").replace(/[^\w.-]/g, "_");
  const ext = req.query.ext === "3mf" ? "3mf" : "stl";
  const file = path.join(EXPORT_DIR, `${name}.${ext}`);
  try {
    await mkdir(EXPORT_DIR, { recursive: true });
    await writeFile(file, req.body);
    await new Promise((resolve, reject) =>
      execFile("open", ["-a", BAMBU_APP, file], (err) => (err ? reject(err) : resolve())));
    res.json({ path: file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
app.use(vite.middlewares);
app.listen(PORT, () => console.log(`openGrid Tile Studio → http://localhost:${PORT}`));
