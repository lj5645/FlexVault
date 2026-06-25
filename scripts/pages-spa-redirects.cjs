const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, '_redirects'), '/* /index.html 200\n');
