import sharp from 'sharp';
/** Tiny generated JPEG with standard TIFF date/GPS tags; no private fixture photographs. */
export async function photoImage(date = '2026:10:03 16:45:20') {
  const jpeg = await sharp({ create: { width: 96, height: 128, channels: 3, background: '#52745f' } }).jpeg().toBuffer();
  const tiff = Buffer.alloc(178); tiff.write('II', 0); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  const entry = (offset: number, tag: number, type: number, count: number, value: number) => { tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2); tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8); };
  tiff.writeUInt16LE(2, 8); entry(10, 34665, 4, 1, 38); entry(22, 34853, 4, 1, 56);
  tiff.writeUInt16LE(1, 38); entry(40, 36867, 2, 20, 110); tiff.write(date + '\0', 110, 'ascii');
  tiff.writeUInt16LE(4, 56); entry(58, 1, 2, 2, 78); entry(70, 2, 5, 3, 130); entry(82, 3, 2, 2, 69); entry(94, 4, 5, 3, 154);
  for (const [offset, dms] of [[130, [30, 36, 0]], [154, [114, 18, 0]]] as const) dms.forEach((n, i) => { tiff.writeUInt32LE(n, offset + i * 8); tiff.writeUInt32LE(1, offset + i * 8 + 4); });
  const data = Buffer.concat([Buffer.from('Exif\0\0'), tiff]), header = Buffer.from([255, 225, 0, 0]); header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, data, jpeg.subarray(2)]);
}
