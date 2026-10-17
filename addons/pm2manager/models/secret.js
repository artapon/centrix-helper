// Agent tokens must be replayed to the agent on every call, so they are stored encrypted (not hashed).
// AES-256-GCM with a random key kept in data/.pm2manager-key: a copy of data/app.sqlite alone does
// not hand over every monitored server; anyone who can read the whole data folder still can.
// The auth tag makes a tampered or truncated value fail instead of decrypting to garbage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_FILE = path.join(__dirname, '..', '..', '..', 'data', '.pm2manager-key');
const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

let key = null;
function getKey() {
  if (key) return key;
  if (fs.existsSync(KEY_FILE)) {
    key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  } else {
    key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  }
  if (key.length !== 32) throw new Error(`${KEY_FILE} is not a valid key`);
  return key;
}

exports.encrypt = function (plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
};

// Throws on tampering, on a changed key file and on a value that was never encrypted.
exports.decrypt = function (stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Stored secret is not in the expected format');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
};
