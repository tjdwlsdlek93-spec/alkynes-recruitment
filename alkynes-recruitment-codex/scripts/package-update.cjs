// Usage: node scripts/package-update.cjs /absolute/portable/package /output/directory
// Publish both output files as assets of the latest public GitHub release.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { safeName } = require('../portable/update.cjs');
const root = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || 'release');
const info = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name), relative = path.relative(root, full).split(path.sep).join('/');
    if (fs.statSync(full).isDirectory()) { if (relative === 'site' || relative.startsWith('site/')) walk(full); }
    else if (safeName(relative)) files.push({ name: relative, content: fs.readFileSync(full).toString('base64') });
  }
}
walk(root);
const content = zlib.gzipSync(Buffer.from(JSON.stringify({ ...info, files })), { level: 9 });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'alkynes-update.json.gz'), content);
fs.writeFileSync(path.join(out, 'alkynes-update.json'), JSON.stringify({ ...info, sha256: crypto.createHash('sha256').update(content).digest('hex'), notes: info.notes || '채용관리 앱 기능 및 화면 개선' }, null, 2));
console.log('Update bundle generated:', info.version, files.length, 'files');
