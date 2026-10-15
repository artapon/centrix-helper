// A small ZIP reader / writer on Node's zlib, for add-on packages (Marketplace upload and the starter add-on).
// Reads stored and deflated entries; refuses encrypted, ZIP64 and other compression methods, and stops at the
// size limits given (protection against zip bombs). Writes deflated entries.
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function bad(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

/**
 * The files of a ZIP: [{ name, data }] (folders left out). Limits: maxFiles, maxBytes (all files unpacked).
 */
exports.read = function (buf, { maxFiles = 2000, maxBytes = 50 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bad('This is not a ZIP file.');
  // End of central directory: in the last 65,557 bytes (22 + the longest comment)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad('This is not a ZIP file (no central directory).');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || cdOffset === 0xFFFFFFFF) throw bad('ZIP64 archives are not supported; zip the add-on with a standard ZIP tool.');
  if (count > maxFiles) throw bad(`The ZIP has more than ${maxFiles} entries.`);

  const files = [];
  let p = cdOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad('The ZIP is damaged (central directory).');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;                       // a folder
    if (flags & 1) throw bad(`"${name}" is encrypted; upload a ZIP without a password.`);
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF) throw bad('ZIP64 archives are not supported.');
    total += usize;
    if (total > maxBytes) throw bad(`The add-on is larger than ${Math.round(maxBytes / 1048576)} MB unpacked.`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw bad(`The ZIP is damaged ("${name}").`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw, { maxOutputLength: usize + 1 }); } catch (e) { throw bad(`"${name}" could not be unpacked.`); }
    } else throw bad(`"${name}" uses a compression method that is not supported (${method}); use a standard ZIP tool.`);
    if (data.length !== usize || crc32(data) !== crc) throw bad(`"${name}" is damaged (checksum).`);
    files.push({ name, data });
  }
  return files;
};

/** A ZIP (Buffer) of [{ name, data: Buffer | string }], deflated. */
exports.write = function (files) {
  const locals = [], centrals = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  files.forEach((f) => {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const comp = zlib.deflateRawSync(data);
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
};
