function register(ipcMain, db) {
  const d = db.getInstance();

  ipcMain.handle('config:obtener', () => {
    const rows = d.all('SELECT clave, valor FROM config');
    const cfg = {};
    for (const r of rows) {
      try { cfg[r.clave] = JSON.parse(r.valor); }
      catch { cfg[r.clave] = r.valor; }
    }
    return cfg;
  });

  ipcMain.handle('config:guardar', (_, cambios) => {
    d.transaction(() => {
      for (const [k, v] of Object.entries(cambios)) {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        d.run('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)', k, val);
      }
    });
    return { ok: true };
  });

  ipcMain.handle('config:resetear', () => {
    const defs = {
      nombre_negocio:'Mi Negocio',moneda:'USD',simbolo_moneda:'$',
      impuesto_porcentaje:'16',aplicar_impuesto:'1',color_primario:'#6366f1',tema:'dark'
    };
    d.transaction(() => {
      for (const [k,v] of Object.entries(defs))
        d.run('INSERT OR REPLACE INTO config (clave,valor) VALUES (?,?)', k, v);
    });
    return { ok: true };
  });
}

module.exports = { register };
