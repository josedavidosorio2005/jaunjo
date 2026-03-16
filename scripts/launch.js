#!/usr/bin/env node
/**
 * Lanzador multiplataforma para ContaFlex.
 * Usado por `npm run launch` en Windows, Linux y macOS.
 */
const { execFile } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

let electronBin;
if (process.platform === 'win32') {
  electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
} else if (process.platform === 'darwin') {
  electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
} else {
  // Linux y demás Unix
  electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
}

const child = execFile(electronBin, ['.'], { cwd: root });

child.on('error', (err) => {
  console.error('Error al iniciar ContaFlex:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code || 0);
});
