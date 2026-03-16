const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path    = require('path');
const QRCode  = require('qrcode');
const db           = require('../database/db');
const servidor     = require('../server/server');
const ventasIPC    = require('../ipc/ventas');
const inventarioIPC = require('../ipc/inventario');
const clientesIPC  = require('../ipc/clientes');
const comprasIPC   = require('../ipc/compras');
const reportesIPC  = require('../ipc/reportes');
const configIPC    = require('../ipc/config');
const usuariosIPC  = require('../ipc/usuarios');
const arqueoIPC    = require('../ipc/arqueo');

// Puerto del servidor web (se lee de config tras inicializar la BD)
let SERVER_PORT = 3535;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,   // no ralentizar cuando la ventana pierde foco
      v8CacheOptions: 'bypassHeatCheck', // usar caché V8 desde el primer arranque
    },
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Permitir window.open para impresión de recibos
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'allow', overrideBrowserWindowOptions: { width: 500, height: 750, modal: true, parent: mainWindow } };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    // 1. Inicializar base de datos PRIMERO
    await db.init();

    // 2. Registrar TODOS los handlers IPC antes de abrir la ventana
    ventasIPC.register(ipcMain, db);
    inventarioIPC.register(ipcMain, db);
    clientesIPC.register(ipcMain, db);
    comprasIPC.register(ipcMain, db);
    reportesIPC.register(ipcMain, db);
    configIPC.register(ipcMain, db);
    usuariosIPC.register(ipcMain, db);
    arqueoIPC.register(ipcMain, db);

    // Handler para abrir diálogos de archivo
    ipcMain.handle('dialog:openFile', async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'gif', 'svg'] }]
      });
      return result;
    });

    // Handler para controles de ventana
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
      mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
    });
    ipcMain.on('window:close', () => mainWindow?.close());

    // ── Handlers IPC del servidor web ────────────────────────────
    ipcMain.handle('server:status', () => servidor.getStatus());

    ipcMain.handle('server:start', (_, port) => {
      const p = port || SERVER_PORT;
      return servidor.start(db, p);
    });

    ipcMain.handle('server:stop', () => {
      servidor.stop();
      return servidor.getStatus();
    });

    ipcMain.handle('server:qr', async (_, url) => {
      try {
        const dataUrl = await QRCode.toDataURL(url, {
          width: 300,
          margin: 2,
          color: { dark: '#f1f5f9', light: '#1e293b' }
        });
        return dataUrl;
      } catch (e) {
        console.error('[ContaFlex] Error generando QR:', e.message);
        return null;
      }
    });

    ipcMain.handle('server:openBrowser', (_, url) => {
      shell.openExternal(url);
    });

    ipcMain.handle('server:openFirewall', async (_, port) => {
      const { exec } = require('child_process');
      const p = parseInt(port) || 3535;
      const isWin   = process.platform === 'win32';
      const isLinux = process.platform === 'linux';
      return new Promise((resolve, reject) => {
        if (isWin) {
          const cmd = `netsh advfirewall firewall delete rule name="ContaFlex-${p}" 2>nul & ` +
            `netsh advfirewall firewall add rule name="ContaFlex-${p}" dir=in action=allow protocol=TCP localport=${p}`;
          exec(cmd, { shell: 'cmd.exe' }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve({ ok: true });
          });
        } else if (isLinux) {
          // Intentar con ufw; si no está disponible, usar iptables
          exec('which ufw', (ufwErr) => {
            if (!ufwErr) {
              exec(`ufw allow ${p}/tcp`, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve({ ok: true });
              });
            } else {
              exec(`iptables -I INPUT -p tcp --dport ${p} -j ACCEPT`, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve({ ok: true });
              });
            }
          });
        } else {
          // macOS u otro SO — no se requiere acción
          resolve({ ok: true, skipped: true });
        }
      });
    });

    ipcMain.handle('server:crearHotspot', async (_, opts) => {
      const { exec } = require('child_process');
      const ssid     = (opts && opts.ssid)     || 'ContaFlex-WiFi';
      const password = (opts && opts.password) || 'contaflex2026';
      const isWin   = process.platform === 'win32';
      const isLinux = process.platform === 'linux';
      return new Promise((resolve, reject) => {
        if (isWin) {
          const cmds = [
            `netsh wlan set hostednetwork mode=allow ssid="${ssid}" key="${password}"`,
            `netsh wlan start hostednetwork`,
          ].join(' & ');
          exec(cmds, { shell: 'cmd.exe' }, (err, stdout, stderr) => {
            if (err) reject(new Error((stderr || stdout || err.message).trim()));
            else     resolve({ ssid, password, ok: true });
          });
        } else if (isLinux) {
          // Usar nmcli (NetworkManager) para crear hotspot WiFi en Linux
          exec('which nmcli', (nmErr) => {
            if (!nmErr) {
              const cmd = `nmcli device wifi hotspot ifname wlan0 ssid "${ssid}" password "${password}"`;
              exec(cmd, (err, stdout, stderr) => {
                if (err) reject(new Error((stderr || stdout || err.message).trim()));
                else     resolve({ ssid, password, ok: true });
              });
            } else {
              reject(new Error('nmcli no está disponible. Instala NetworkManager para usar esta función.'));
            }
          });
        } else {
          reject(new Error('Crear hotspot no está soportado en este sistema operativo.'));
        }
      });
    });

    // ── Imprimir ticket ─────────────────────────────────────────────────────
    ipcMain.handle('ticket:imprimir', (_, htmlContent) => {
      return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
          width: 420, height: 680, show: false,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
        win.webContents.once('did-finish-load', () => {
          win.webContents.print({ silent: false, printBackground: false }, (success, reason) => {
            win.destroy();
            if (success) resolve({ ok: true });
            else reject(new Error(reason || 'Impresión cancelada'));
          });
        });
        win.webContents.once('render-process-gone', () => {
          reject(new Error('Error al cargar el ticket'));
        });
      });
    });

    // ── Vista previa del ticket (muestra la ventana) ──────────────────────────
    ipcMain.handle('ticket:preview', (_, htmlContent) => {
      const win = new BrowserWindow({
        width: 420, height: 680, show: true,
        title: 'Vista previa del ticket',
        parent: mainWindow, modal: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
      return { ok: true };
    });

    // 3. Arrancar el servidor web automáticamente
    try {
      const cfgRow = db.getInstance().get("SELECT valor FROM config WHERE clave='server_port'");
      if (cfgRow) SERVER_PORT = parseInt(cfgRow.valor) || 3535;
      servidor.start(db, SERVER_PORT);
      console.log('[ContaFlex] Servidor web listo en puerto', SERVER_PORT);
    } catch (srvErr) {
      console.warn('[ContaFlex] No se pudo iniciar el servidor web:', srvErr.message);
    }

    // 4. Abrir la ventana DESPUÉS de que todo esté listo
    createWindow();

  } catch (err) {
    console.error('[ContaFlex] Error fatal al iniciar:', err);
    // Mostrar error al usuario si la BD no cargó
    const { dialog: nativeDialog } = require('electron');
    nativeDialog.showErrorBox(
      'Error al iniciar ContaFlex',
      `No se pudo inicializar la base de datos.\n\n${err.message}\n\nIntenta cerrar y volver a abrir la aplicación.`
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Forzar guardado final antes de salir (por si hay un save diferido pendiente)
  try { db.getInstance().forceSave(); } catch (_) {}
  if (process.platform !== 'darwin') app.quit();
});
