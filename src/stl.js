// Minimal binary STL helpers: parse to flat positions, and write several transformed meshes
// into one binary STL (used to compose print plates).
import * as THREE from "three";

// Accepts an ArrayBuffer or a Uint8Array view (honouring its byteOffset / byteLength).
export function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export function parseStl(data) {
  const buffer = toArrayBuffer(data);
  const dv = new DataView(buffer);
  const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let i = 0, o = 84; i < n; i++, o += 50) {
    for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
  }
  return pos;
}

export function bboxOf(pos) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) box.expandByPoint(v.set(pos[i], pos[i + 1], pos[i + 2]));
  return box;
}

// items: [{ pos: Float32Array, matrix: THREE.Matrix4 }]
export function writeStl(items) {
  const total = items.reduce((s, it) => s + it.pos.length / 9, 0);
  const buf = new ArrayBuffer(84 + total * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode("openGrid Tile Studio").subarray(0, 80));
  dv.setUint32(80, total, true);
  let o = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const { pos, matrix } of items) {
    for (let i = 0; i < pos.length; i += 9) {
      a.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(matrix);
      b.set(pos[i + 3], pos[i + 4], pos[i + 5]).applyMatrix4(matrix);
      c.set(pos[i + 6], pos[i + 7], pos[i + 8]).applyMatrix4(matrix);
      nrm.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      for (const v of [nrm, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return new Uint8Array(buf);
}
