// Accepts an ArrayBuffer or a Uint8Array view (honouring its byteOffset / byteLength).
export function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
