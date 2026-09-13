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
  // Build plate: dotted outline + dotted 10 mm grid on the z = 0 plane, corner at the origin.
  let bed = null;
  function setBed([w, h, z]) {
    bedSize = [w, h, z];
    if (bed) { scene.remove(bed); bed.traverse((o) => o.geometry?.dispose()); }
    bed = new THREE.Group();
    const pts = [];
    for (let x = 0; x <= w; x += 10) pts.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, h, 0));
    for (let y = 0; y <= h; y += 10) pts.push(new THREE.Vector3(0, y, 0), new THREE.Vector3(w, y, 0));
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0x5a5d6a, dashSize: 0.8, gapSize: 1.6 }));
    grid.computeLineDistances();
    bed.add(grid);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, 0, 0),
        new THREE.Vector3(w, h, 0), new THREE.Vector3(0, h, 0)]),
      new THREE.LineDashedMaterial({ color: 0x9aa0b4, dashSize: 2, gapSize: 2 }));
    outline.computeLineDistances();
    bed.add(outline);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0x2a2c36, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    fill.position.set(w / 2, h / 2, -0.05);
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
    const box = modelBox.clone().union(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(bedSize[0], bedSize[1], 0)));
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

  function setColor(hex) {
    material.color.set(hex);
    // Very dark filaments would render as a silhouette; lift the shaded color slightly.
    const hsl = {}; material.color.getHSL(hsl);
    if (hsl.l < 0.08) material.color.setHSL(hsl.h, hsl.s, 0.08);
  }

  return { setStl, setBed, setColor, refit: () => mesh && frame(mesh.geometry.boundingBox) };
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
