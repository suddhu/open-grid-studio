// three.js STL viewer — the same library Printables / MakerWorld / Thingiverse use for model previews.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export function createViewer(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1f24);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  camera.up.set(0, 0, 1); // OpenSCAD is Z-up
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(1, -1, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-1, 1, 0.5);
  scene.add(fill);
  // Build plate: dotted outline + dotted 10 mm grid on the z = 0 plane, centred on the origin
  // (the openGrid tile is centred in XY, as it is when dropped onto a slicer plate).
  let bed = null;
  function setBed([w, h, z]) {
    bedSize = [w, h, z];
    if (bed) { scene.remove(bed); bed.traverse((o) => o.geometry?.dispose()); }
    bed = new THREE.Group();
    const pts = [];
    const x0 = -w / 2, y0 = -h / 2;
    for (let x = 0; x <= w; x += 10) pts.push(new THREE.Vector3(x0 + x, y0, 0), new THREE.Vector3(x0 + x, y0 + h, 0));
    for (let y = 0; y <= h; y += 10) pts.push(new THREE.Vector3(x0, y0 + y, 0), new THREE.Vector3(x0 + w, y0 + y, 0));
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0x5a5d6a, dashSize: 0.8, gapSize: 1.6 }));
    grid.computeLineDistances();
    bed.add(grid);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x0 + w, y0, 0),
        new THREE.Vector3(x0 + w, y0 + h, 0), new THREE.Vector3(x0, y0 + h, 0)]),
      new THREE.LineDashedMaterial({ color: 0x9aa0b4, dashSize: 2, gapSize: 2 }));
    outline.computeLineDistances();
    bed.add(outline);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0x2a2c36, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    fill.position.set(0, 0, -0.05);
    bed.add(fill);
    scene.add(bed);
    if (mesh) frame(mesh.geometry.boundingBox);
  }
  // Labelled XYZ axes at the model origin (X red, Y green, Z blue), drawn on top of the mesh.
  scene.add(makeAxes(60, 8));
  // Small orientation gizmo in the bottom-right corner that follows the camera rotation.
  const gizmoScene = new THREE.Scene();
  gizmoScene.add(makeAxes(1, 0.35));
  const gizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  gizmoCamera.up.set(0, 0, 1);
  const GIZMO_PX = 110;

  const material = new THREE.MeshStandardMaterial({ color: 0xf28c28, roughness: 0.55, metalness: 0.05 });
  let mesh = null;

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let bedSize = [0, 0, 0];
  function frame(modelBox) {
    // Frame the union of the model and the build plate
    const box = modelBox.clone().union(new THREE.Box3(
      new THREE.Vector3(-bedSize[0] / 2, -bedSize[1] / 2, 0), new THREE.Vector3(bedSize[0] / 2, bedSize[1] / 2, 0)));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x + radius * 0.9, center.y - radius * 1.2, center.z + radius * 0.9);
    controls.target.copy(center);
    controls.update();
  }

  function setStl(buffer, { refit }) {
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    geometry.computeBoundingBox();
    if (refit) frame(geometry.boundingBox);
    return geometry.boundingBox;
  }

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.autoClear = true;
    renderer.setViewport(0, 0, container.clientWidth, container.clientHeight);
    renderer.render(scene, camera);
    // Gizmo: same view direction as the main camera, fixed distance, corner viewport
    gizmoCamera.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(4);
    gizmoCamera.lookAt(0, 0, 0);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setViewport(container.clientWidth - GIZMO_PX - 8, 8, GIZMO_PX, GIZMO_PX);
    renderer.render(gizmoScene, gizmoCamera);
  })();

  // ---- clickable 3D handles (corner chamfers / edge connector holes / screw rings) ----
  const handleGroup = new THREE.Group();
  scene.add(handleGroup);
  const raycaster = new THREE.Raycaster();
  const HANDLE_ON = new THREE.Color(0xf28c28), HANDLE_OFF = new THREE.Color(0x5a5d6a);
  let handles = [];        // { hit: Mesh (pickable), vis: Mesh (coloured), item }
  let placing = false;     // part placement mode (see parts layer below)
  let partDrag = null;
  let measuring = false;   // measure tool (see below)
  let onHandleClick = () => {};
  let hovered = null;

  // items: [{ id, outline: [[x,y],...] (closed loop on the top face), z, on, enabled, label }]
  // Each handle is a fat outline drawn on the mesh; the filled region inside it is the click target.
  const HANDLE_HOVER = new THREE.Color(0xffffff);
  function setHandles(items, onClick) {
    onHandleClick = onClick;
    handleGroup.clear();
    handles = items.map((it) => {
      const pts = it.outline.flatMap(([x, y]) => [x, y, it.z]);
      pts.push(it.outline[0][0], it.outline[0][1], it.z); // close the loop
      const geom = new LineGeometry().setPositions(pts);
      const mat = new LineMaterial({ color: HANDLE_OFF.getHex(), linewidth: 0.9, worldUnits: true, depthTest: false, transparent: true });
      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 997;
      // Invisible fill for hit-testing
      const shape = new THREE.Shape(it.outline.map(([x, y]) => new THREE.Vector2(x, y)));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ visible: false }));
      fill.position.z = it.z;
      handleGroup.add(line, fill);
      const h = { hit: [fill], line, item: it };
      fill.userData.handle = h;
      return h;
    });
    syncHandles(items);
  }
  function syncHandles(items) {
    for (const h of handles) {
      h.item = items.find((i) => i.id === h.item.id) ?? h.item;
      h.line.material.color.copy(h.item.on ? HANDLE_ON : HANDLE_OFF);
      h.line.material.opacity = h.item.enabled === false ? 0.3 : 1;
    }
  }
  function pointerNDC(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  function pick(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    const hit = raycaster.intersectObjects([...handles.flatMap((h) => h.hit), ...resizeArrows], false)[0]?.object;
    return hit?.userData.handle ?? hit?.userData.resize ?? null;
  }

  // ---- drag-to-resize arrows (board width / height in whole tiles) ---------------------
  let resizeArrows = [];
  let resizeCfg = null;   // { box, cols, rows, onResize }
  let drag = null;        // { axis, cols, rows }
  const preview = new THREE.Group();
  scene.add(preview);
  const dragPlane = new THREE.Plane();

  function setResizeHandles(cfg) {
    resizeCfg = cfg;
    for (const a of resizeArrows) { scene.remove(a); a.geometry.dispose(); }
    resizeArrows = [];
    if (!cfg) return;
    const { min, max } = cfg.box;
    const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, z = max.z + 6;
    const OUT = 34;
    const mk = (axis, x, y, rotZ, label) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(4.5, 12, 18),
        new THREE.MeshStandardMaterial({ color: 0x69b1ff, roughness: 0.4 }));
      m.position.set(x, y, z);
      m.rotation.z = rotZ; // cone points +Y by default
      m.userData.resize = { axis, label };
      scene.add(m);
      resizeArrows.push(m);
    };
    mk("x", max.x + OUT, cy, -Math.PI / 2, "Drag to change board width");
    mk("y", cx, max.y + OUT, 0, "Drag to change board height");
  }
  function showPreview(cols, rows, z) {
    preview.clear();
    const w = cols * 28, h = rows * 28;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-w / 2, -h / 2, z), new THREE.Vector3(w / 2, -h / 2, z),
        new THREE.Vector3(w / 2, h / 2, z), new THREE.Vector3(-w / 2, h / 2, z)]),
      new THREE.LineDashedMaterial({ color: 0x69b1ff, dashSize: 4, gapSize: 3, depthTest: false }));
    outline.computeLineDistances();
    outline.renderOrder = 998;
    preview.add(outline);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(`${cols} × ${rows}`, 0x69b1ff), depthTest: false, transparent: true }));
    label.scale.set(40, 20, 1);
    label.position.set(0, 0, z + 10);
    label.renderOrder = 1001;
    preview.add(label);
  }

  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    downAt = [ev.clientX, ev.clientY];
    if (placing || measuring) return;
    const p = pick(ev);
    if (p?.axis && resizeCfg) {
      // Start a resize drag on the plane of the board's top face
      drag = { axis: p.axis, cols: resizeCfg.cols, rows: resizeCfg.rows };
      controls.enabled = false;
      dragPlane.set(new THREE.Vector3(0, 0, 1), -resizeCfg.box.max.z);
      renderer.domElement.setPointerCapture(ev.pointerId);
      showPreview(drag.cols, drag.rows, resizeCfg.box.max.z);
    }
  });
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (drag) {
      raycaster.setFromCamera(pointerNDC(ev), camera);
      const hitPt = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, hitPt)) return;
      const { box } = resizeCfg;
      const c = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0);
      // Board is centred, so the dragged edge sits at half the size; arrow offset (34 mm) subtracted
      const clamp = (v) => Math.max(1, Math.min(16, v));
      if (drag.axis === "x") drag.cols = clamp(Math.round(((hitPt.x - c.x - 34) * 2) / 28));
      else drag.rows = clamp(Math.round(((hitPt.y - c.y - 34) * 2) / 28));
      showPreview(drag.cols, drag.rows, box.max.z);
      return;
    }
    const h = pick(ev);
    if (h !== hovered) {
      if (hovered?.line) hovered.line.material.color.copy(hovered.item.on ? HANDLE_ON : HANDLE_OFF);
      hovered = h;
      if (h?.line) h.line.material.color.copy(HANDLE_HOVER);
      if (!measuring) renderer.domElement.style.cursor = h ? (h.axis ? (h.axis === "x" ? "ew-resize" : "ns-resize") : "pointer") : "";
      renderer.domElement.title = h ? (h.item?.label ?? h.label ?? "") : "";
    }
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (drag) {
      const { cols, rows } = drag;
      drag = null;
      controls.enabled = true;
      preview.clear();
      if (cols !== resizeCfg.cols || rows !== resizeCfg.rows) resizeCfg.onResize(cols, rows);
      return;
    }
    // A click, not an orbit drag: pointer moved less than a few pixels
    if (placing || measuring || partDrag || !downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    const h = pick(ev);
    if (h?.item) onHandleClick(h.item.id);
  });

  // ---- placed parts, snaps and the placement ghost ------------------------------------
  const partsGroup = new THREE.Group();
  scene.add(partsGroup);
  const PART_COLOR = 0xf2a93b; // amber: complementary to the steel-blue board
  const partMaterial = new THREE.MeshStandardMaterial({ color: PART_COLOR, roughness: 0.6 });
  const partSelected = new THREE.MeshStandardMaterial({ color: PART_COLOR, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.25 });
  const snapMaterial = new THREE.MeshStandardMaterial({ color: 0xc9861f, roughness: 0.7 }); // darker amber
  let partMeshes = [];
  const listeners = {};
  const on = (name, fn) => { listeners[name] = fn; };
  const emit = (name, ...args) => listeners[name]?.(...args);

  // parts: [{ id, geometry, matrix, selected, snaps: [Matrix4], snapGeometry }]
  function setParts(parts) {
    partsGroup.clear();
    partMeshes = parts.map((p) => {
      const m = new THREE.Mesh(p.geometry, p.selected ? partSelected : partMaterial);
      m.matrixAutoUpdate = false;
      m.matrix.copy(p.matrix);
      m.userData.partId = p.id;
      partsGroup.add(m);
      for (const sm of p.snaps) {
        const sn = new THREE.Mesh(p.snapGeometry, snapMaterial);
        sn.matrixAutoUpdate = false;
        sn.matrix.copy(sm);
        partsGroup.add(sn);
      }
      return m;
    });
  }

  const ghost = new THREE.Group();
  scene.add(ghost);
  const ghostOk = new THREE.MeshBasicMaterial({ color: 0x69b1ff, transparent: true, opacity: 0.35, depthTest: false });
  const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.35, depthTest: false });
  // cells: [[c, r], ...] world rectangles via centres; z: top face
  function setGhost(cellRects, valid, geometry, matrix) {
    ghost.clear();
    for (const [x, y, w, h, z] of cellRects) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w - 2, h - 2), valid ? ghostOk : ghostBad);
      m.position.set(x, y, z + 0.2);
      m.renderOrder = 996;
      ghost.add(m);
    }
    if (geometry && matrix) {
      const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: PART_COLOR, transparent: true, opacity: 0.5 }));
      m.matrixAutoUpdate = false;
      m.matrix.copy(matrix);
      ghost.add(m);
    }
  }
  const clearGhost = () => ghost.clear();

  // Pointer position on the plane z = zPlane, in world XY (null if the ray misses)
  function boardPoint(ev, zPlane) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    const pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), -zPlane);
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(pl, pt) ? [pt.x, pt.y] : null;
  }
  function pickPart(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    return raycaster.intersectObjects(partMeshes, false)[0]?.object.userData.partId ?? null;
  }
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    if (drag || placing || measuring) return;
    const id = pickPart(ev);
    if (id != null) { partDrag = { id, moved: false }; controls.enabled = false; renderer.domElement.setPointerCapture(ev.pointerId); }
  });
  const setPlacing = (v) => { placing = v; if (!v) clearGhost(); };
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (partDrag) {
      if (!partDrag.moved && downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) partDrag.moved = true;
      if (partDrag.moved) emit("partdrag", partDrag.id, ev);
      return;
    }
    if (placing) { emit("placemove", ev); return; }
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (partDrag) {
      const { id, moved } = partDrag;
      partDrag = null;
      controls.enabled = true;
      emit(moved ? "partdrop" : "partclick", id, ev);
      return;
    }
    if (placing && downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) <= 4) { emit("placeclick", ev); return; }
    if (!drag && !measuring && downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) <= 4 && !pick(ev)) emit("emptyclick");
  });
  const geometryFromStl = (buffer) => { const g = new STLLoader().parse(buffer); g.computeVertexNormals(); return g; };

  // ---- measure tool --------------------------------------------------------------------
  // Click two points on any surface; snaps to the nearest mesh vertex within 1.5 mm so edges and
  // corners measure exactly. Shows the straight-line distance plus the X/Y/Z deltas.
  const measureGroup = new THREE.Group();
  scene.add(measureGroup);
  let measureUnit = "mm";
  let measureA = null, measureB = null; // Vector3 or null
  const mkMarker = (p) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0x69b1ff, depthTest: false })); m.position.copy(p); m.renderOrder = 1002; return m; };
  const fmt = (mm) => measureUnit === "in" ? `${(mm / 25.4).toFixed(3)} in` : `${mm.toFixed(1)} mm`;
  function measurePick(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    const targets = [mesh, ...partMeshes, ...partsGroup.children].filter(Boolean);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    // Snap to the nearest vertex of the hit face if it is close
    const g = hit.object.geometry, pos = g.attributes.position, idx = g.index;
    const f = hit.face;
    let best = hit.point.clone(), bestD = 1.5;
    for (const vi of [f.a, f.b, f.c]) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(vi) : vi).applyMatrix4(hit.object.matrixWorld);
      const d = v.distanceTo(hit.point);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }
  function drawMeasure(a, b) {
    measureGroup.clear();
    if (a) measureGroup.add(mkMarker(a));
    if (a && b) {
      measureGroup.add(mkMarker(b));
      const geom = new LineGeometry().setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      const line = new Line2(geom, new LineMaterial({ color: 0x69b1ff, linewidth: 0.6, worldUnits: true, depthTest: false }));
      line.renderOrder = 1001;
      measureGroup.add(line);
      const d = a.distanceTo(b);
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), dz = Math.abs(b.z - a.z);
      renderer.domElement.dataset.measure = fmt(d); // readable by tests / the status line
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture2(fmt(d), `Δ ${fmt(dx)} · ${fmt(dy)} · ${fmt(dz)}`), depthTest: false, transparent: true }));
      label.scale.set(56, 22, 1);
      label.position.copy(a).add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0, 8));
      label.renderOrder = 1003;
      measureGroup.add(label);
    }
  }
  function setMeasuring(v, unit) {
    measuring = v;
    if (unit) measureUnit = unit;
    if (!v) { measureA = measureB = null; measureGroup.clear(); renderer.domElement.style.cursor = ""; }
    else drawMeasure(measureA, measureB);
  }
  const clearMeasure = () => { measureA = measureB = null; measureGroup.clear(); };
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (!measuring) return;
    renderer.domElement.style.cursor = "crosshair";
    if (measureA && !measureB) { const p = measurePick(ev); if (p) drawMeasure(measureA, p); }
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!measuring || !downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    const p = measurePick(ev);
    if (!p) return;
    if (!measureA || measureB) { measureA = p; measureB = null; }
    else measureB = p;
    drawMeasure(measureA, measureB);
  });

  function viewTop() {
    const box = mesh ? mesh.geometry.boundingBox : new THREE.Box3(new THREE.Vector3(-90, -90, 0), new THREE.Vector3(90, 90, 0));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    camera.position.set(center.x, center.y - 0.001, center.z + Math.max(size.x, size.y, bedSize[0], bedSize[1]) * 1.4);
    controls.target.copy(center);
    controls.update();
  }

  function setColor(hex) {
    material.color.set(hex);
    // Very dark filaments would render as a silhouette; lift the shaded color slightly.
    const hsl = {}; material.color.getHSL(hsl);
    if (hsl.l < 0.08) material.color.setHSL(hsl.h, hsl.s, 0.08);
  }

  return { setStl, setBed, setColor, setHandles, syncHandles, setResizeHandles, viewTop,
    setParts, setGhost, clearGhost, setPlacing, boardPoint, geometryFromStl, on, setMeasuring, clearMeasure,
    refit: () => mesh && frame(mesh.geometry.boundingBox) };
}

// Three colored axis lines with text labels; depthTest off so they show through geometry.
function makeAxes(length, labelSize) {
  const group = new THREE.Group();
  const axes = [
    ["X", 0xff4d4d, new THREE.Vector3(1, 0, 0)],
    ["Y", 0x4dff4d, new THREE.Vector3(0, 1, 0)],
    ["Z", 0x4d8cff, new THREE.Vector3(0, 0, 1)],
  ];
  for (const [name, color, dir] of axes) {
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(length)]);
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = 999;
    group.add(line);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, color), depthTest: false, transparent: true }));
    sprite.renderOrder = 1000;
    sprite.scale.setScalar(labelSize);
    sprite.position.copy(dir).multiplyScalar(length * 1.12);
    group.add(sprite);
  }
  return group;
}

function textTexture(text, color) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(20,21,24,0.85)";
  ctx.beginPath(); ctx.roundRect(28, 24, 200, 80, 16); ctx.fill();
  ctx.font = "bold 56px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textTexture2(line1, line2) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 200;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(20,21,24,0.88)";
  ctx.beginPath(); ctx.roundRect(16, 16, 480, 168, 24); ctx.fill();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#69b1ff"; ctx.font = "bold 72px system-ui, sans-serif"; ctx.fillText(line1, 256, 76);
  ctx.fillStyle = "#c9cbd3"; ctx.font = "34px system-ui, sans-serif"; ctx.fillText(line2, 256, 146);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelTexture(text, color) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
