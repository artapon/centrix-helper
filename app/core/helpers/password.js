const crypto = require('crypto');

// scrypt with a per-password salt; stored as "scrypt$<salt hex>$<hash hex>".
const KEY_LENGTH = 64;
const MIN_LENGTH = 8;

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
});

exports.MIN_LENGTH = MIN_LENGTH;

exports.hash = async function (password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
};

exports.verify = async function (password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scrypt(String(password), Buffer.from(saltHex, 'hex'));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
};

// Returns an error message, or '' when the password is acceptable.
exports.validate = function (password, confirm) {
  if (!password || String(password).length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters.`;
  if (confirm !== undefined && password !== confirm) return 'Passwords do not match.';
  return '';
};
