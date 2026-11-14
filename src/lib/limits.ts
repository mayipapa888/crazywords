export const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 2 * 1024 * 1024);
export const MAX_CSV_BYTES = Number(process.env.MAX_CSV_BYTES || 1 * 1024 * 1024);
export const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 3 * 1024 * 1024);

export function assertByteLimit(size: number, max: number, label: string) {
  if (size > max) {
    throw new Error(`${label}超过上限（${size} > ${max} 字节）`);
  }
}

export function bufferFromBase64(b64: string, max: number, label: string): Buffer {
  const approx = Math.ceil((b64.length * 3) / 4);
  assertByteLimit(approx, max, label);
  const buf = Buffer.from(b64, "base64");
  assertByteLimit(buf.length, max, label);
  return buf;
}
