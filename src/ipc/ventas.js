function register(ipcMain, db) {
  const d = db.getInstance();

  ipcMain.handle('ventas:obtenerTodas', (_, filtros = {}) => {
    let sql = `
      SELECT v.*, c.nombre AS cliente_nombre
      FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id WHERE 1=1`;
    const params = [];
    if (filtros.desde) { sql += ' AND date(v.fecha) >= date(?)'; params.push(filtros.desde); }
    if (filtros.hasta) { sql += ' AND date(v.fecha) <= date(?)'; params.push(filtros.hasta); }
    if (filtros.estado) { sql += ' AND v.estado = ?'; params.push(filtros.estado); }
    sql += ' ORDER BY v.id DESC LIMIT 500';
    return d.all(sql, ...params);
  });

  ipcMain.handle('ventas:obtenerPorId', (_, id) => {
    const venta = d.get(`
      SELECT v.*, c.nombre AS cliente_nombre FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id WHERE v.id = ?`, id);
    if (venta) venta.detalle = d.all('SELECT * FROM ventas_detalle WHERE venta_id = ?', id);
    return venta;
  });

  ipcMain.handle('ventas:resumenHoy', () => {
    const hoy = new Date().toISOString().split('T')[0];
    return d.get(`SELECT COUNT(*) AS total_ventas, COALESCE(SUM(total),0) AS total_ingresos,
      COALESCE(SUM(CASE WHEN estado='anulada' THEN 1 ELSE 0 END),0) AS anuladas
      FROM ventas WHERE date(fecha) = date(?)`, hoy);
  });

  ipcMain.handle('ventas:crear', (_, venta) => {
    return d.transaction(() => {
      const cfg = d.get("SELECT valor FROM config WHERE clave='prefijo_factura'");
      const numRow = d.get("SELECT valor FROM config WHERE clave='siguiente_numero'");
      const prefijo = cfg ? cfg.valor : 'FAC-';
      const num = numRow ? parseInt(numRow.valor) : 1;
      const numero = `${prefijo}${String(num).padStart(6,'0')}`;

      const subtotal = venta.detalle.reduce((s,i) => s + i.total, 0);
      const impPct = parseFloat(d.get("SELECT valor FROM config WHERE clave='impuesto_porcentaje'")?.valor || 0);
      const aplicaImp = d.get("SELECT valor FROM config WHERE clave='aplicar_impuesto'")?.valor === '1';
      const impuesto = aplicaImp ? +((subtotal) * impPct / 100).toFixed(2) : 0;
      const descuento = venta.descuento || 0;
      const total = +(subtotal + impuesto - descuento).toFixed(2);
      const pagado = venta.pagado ?? total;

      d.run(`INSERT INTO ventas (numero,cliente_id,subtotal,descuento,impuesto,total,pagado,metodo_pago,estado,notas)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
        numero, venta.cliente_id || null, subtotal, descuento, impuesto, total, pagado,
        venta.metodo_pago || 'efectivo', pagado < total ? 'credito' : 'completada', venta.notas || null);
      const ventaId = d.lastInsertRowid();

      for (const item of venta.detalle) {
        d.run(`INSERT INTO ventas_detalle (venta_id,producto_id,nombre,cantidad,precio,descuento,total)
               VALUES (?,?,?,?,?,?,?)`,
          ventaId, item.producto_id || null, item.nombre, item.cantidad, item.precio, item.descuento || 0, item.total);
        if (item.producto_id) {
          d.run('UPDATE productos SET stock = stock - ?, actualizado_en = datetime("now","localtime") WHERE id = ?',
            item.cantidad, item.producto_id);
        }
      }

      if (venta.cliente_id && pagado < total) {
        d.run('UPDATE clientes SET saldo_deuda = saldo_deuda + ? WHERE id = ?',
          +(total - pagado).toFixed(2), venta.cliente_id);
      }

      d.run("UPDATE config SET valor = ? WHERE clave = 'siguiente_numero'", String(num + 1));
      return { id: ventaId, numero };
    });
  });

  ipcMain.handle('ventas:anular', (_, id) => {
    return d.transaction(() => {
      const venta = d.get('SELECT * FROM ventas WHERE id = ?', id);
      if (!venta || venta.estado === 'anulada') throw new Error('Venta no válida');

      const detalle = d.all('SELECT * FROM ventas_detalle WHERE venta_id = ?', id);
      for (const item of detalle) {
        if (item.producto_id) {
          d.run('UPDATE productos SET stock = stock + ? WHERE id = ?', item.cantidad, item.producto_id);
        }
      }
      if (venta.cliente_id && venta.pagado < venta.total) {
        d.run('UPDATE clientes SET saldo_deuda = MAX(0, saldo_deuda - ?) WHERE id = ?',
          venta.total - venta.pagado, venta.cliente_id);
      }
      d.run("UPDATE ventas SET estado = 'anulada' WHERE id = ?", id);
      return { ok: true };
    });
  });
}

module.exports = { register };
