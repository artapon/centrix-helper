// Cache-busting for /css and /js: pages reference them as ?v=<hash of their contents at
// startup>, so browsers can cache them for a long time and still pick up a new deploy.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

function hashDir(dir, hash) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) hashDir(file, hash);
    else if (/\.(css|js)$/.test(entry.name)) hash.update(entry.name).update(fs.readFileSync(file));
  }
  return hash;
}

exports.version = hashDir(PUBLIC_DIR, crypto.createHash('sha1')).digest('hex').slice(0, 10);

