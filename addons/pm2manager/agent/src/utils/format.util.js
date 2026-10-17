function formatBytes(bytes, decimals = 2) {
  bytes = Number(bytes);

  if (!bytes || bytes <= 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  // Prevent negative index (size below 1 byte)
  if (bytes < 1) return `${bytes.toFixed(dm)} Bytes`;

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

module.exports = {
  formatBytes
}