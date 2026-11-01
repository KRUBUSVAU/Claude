// Copies the built web app (index.html + icons) into desktop/app so electron-builder can package it.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(__dirname, 'app');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html')); fs.mkdirSync(path.join(out, 'assets'), { recursive: true }); fs.copyFileSync(path.join(root, 'assets', 'brain-data.js'), path.join(out, 'assets', 'brain-data.js'));
for (const f of fs.readdirSync(path.join(root, 'icons'))) fs.copyFileSync(path.join(root, 'icons', f), path.join(out, 'icons', f));
console.log('synced web app into desktop/app');
