'use strict';
const fs = require('fs');
const path = require('path');

/* A prefix check alone follows symlinks (including Windows junctions) outside the
 * permitted directory. The root is trusted; links below it are never served or
 * used as write destinations. Missing descendants are allowed for new files. */
function isSafePath(root, target) {
  const base = path.resolve(root), full = path.resolve(target), rel = path.relative(base, full);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return false;
  let current = base;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) return false; }
    catch (e) { return e.code === 'ENOENT'; }
  }
  return true;
}

module.exports = { isSafePath };
