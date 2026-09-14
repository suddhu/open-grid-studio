// Minimal binary STL writer: several transformed triangle soups into one binary STL (print plates).
import * as THREE from "three";

// Accepts an ArrayBuffer or a Uint8Array view (honouring its byteOffset / byteLength).
export function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// items: [{ pos: Float32Array, matrix: THREE.Matrix4 }]
export function writeStl(items) {
  const total = items.reduce((s, it) => s + it.pos.length / 9, 0);
  const buf = new ArrayBuffer(84 + total * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode("openGrid Tile Studio").subarray(0, 80));
  dv.setUint32(80, total, true);
  let o = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ca = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const { pos, matrix } of items) {
    for (let i = 0; i < pos.length; i += 9) {
      a.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(matrix);
      b.set(pos[i + 3], pos[i + 4], pos[i + 5]).applyMatrix4(matrix);
      c.set(pos[i + 6], pos[i + 7], pos[i + 8]).applyMatrix4(matrix);
      nrm.subVectors(b, a).cross(ca.subVectors(c, a)).normalize();
      for (const v of [nrm, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return new Uint8Array(buf);
}
