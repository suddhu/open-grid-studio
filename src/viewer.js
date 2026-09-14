// three.js STL viewer — the same library Printables / MakerWorld / Thingiverse use for model previews.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

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
  let onHandleClick = () => {};
  let hovered = null;

  // items: [{ id, anchor: [x,y,z] (the feature), tip: [x,y,z] (where the marker sits), on, enabled, label }]
  // Each handle is a leader line from the feature to a small sphere; both are clickable.
  function setHandles(items, onClick) {
    onHandleClick = onClick;
    handleGroup.clear();
    handles = items.map((it) => {
      const a = new THREE.Vector3(...it.anchor), t = new THREE.Vector3(...it.tip);
      const mat = new THREE.MeshStandardMaterial({ color: HANDLE_OFF, roughness: 0.4, transparent: true });
      const lineMat = new THREE.LineBasicMaterial({ color: HANDLE_OFF, transparent: true });
      const group = new THREE.Group();
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, t]), lineMat);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), mat);
      sphere.position.copy(t);
      // Invisible thicker cylinder along the leader so the line itself is easy to click
      const dir = t.clone().sub(a), len = dir.length();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, len, 6), new THREE.MeshBasicMaterial({ visible: false }));
      stem.position.copy(a).addScaledVector(dir, 0.5);
      stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      group.add(line, sphere, stem);
      handleGroup.add(group);
      const h = { hit: [sphere, stem], vis: sphere, line, item: it };
      sphere.userData.handle = stem.userData.handle = h;
      return h;
    });
    syncHandles(items);
  }
  function syncHandles(items) {
    for (const h of handles) {
      h.item = items.find((i) => i.id === h.item.id) ?? h.item;
      const color = h.item.on ? HANDLE_ON : HANDLE_OFF, opacity = h.item.enabled === false ? 0.3 : 1;
      h.vis.material.color.copy(color);
      h.vis.material.opacity = opacity;
      h.vis.material.emissive.set(0x000000);
      h.line.material.color.copy(color);
      h.line.material.opacity = opacity;
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
      hovered?.vis?.material.emissive.set(0x000000);
      hovered = h;
      if (h?.vis) h.vis.material.emissive.set(0x333333);
      renderer.domElement.style.cursor = h ? (h.axis ? (h.axis === "x" ? "ew-resize" : "ns-resize") : "pointer") : "";
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
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    const h = pick(ev);
    if (h?.item) onHandleClick(h.item.id);
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

  return { setStl, setBed, setColor, setHandles, syncHandles, setResizeHandles, viewTop, refit: () => mesh && frame(mesh.geometry.boundingBox) };
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
