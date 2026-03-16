function register(ipcMain, db) {
  const d = db.getInstance();

  ipcMain.handle('compras:obtenerProveedores', () =>
    d.all('SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre'));

  ipcMain.handle('compras:crearProveedor', (_, p) => {
    d.run('INSERT INTO proveedores (nombre,identificacion,telefono,email,direccion,notas) VALUES (?,?,?,?,?,?)',
      p.nombre, p.identificacion||null, p.telefono||null, p.email||null, p.direccion||null, p.notas||null);
    return { id: d.lastInsertRowid() };
  });

  ipcMain.handle('compras:registrarCompra', (_, compra) => {
    return d.transaction(() => {
      const subtotal = compra.detalle.reduce((s,i) => s + i.total, 0);
      const total = +(subtotal + (compra.impuesto || 0)).toFixed(2);
      const pagado = compra.pagado ?? total;

      d.run(`INSERT INTO compras (numero,proveedor_id,subtotal,impuesto,total,pagado,estado,notas)
             VALUES (?,?,?,?,?,?,?,?)`,
        compra.numero||null, compra.proveedor_id||null, subtotal, compra.impuesto||0,
        total, pagado, pagado < total ? 'pendiente' : 'pagada', compra.notas||null);
      const compraId = d.lastInsertRowid();

      for (const item of compra.detalle) {
        d.run('INSERT INTO compras_detalle (compra_id,producto_id,nombre,cantidad,precio,total) VALUES (?,?,?,?,?,?)',
          compraId, item.producto_id||null, item.nombre, item.cantidad, item.precio, item.total);
        if (item.producto_id) {
          d.run('UPDATE productos SET stock = stock + ?, precio_compra = ?, actualizado_en = datetime("now","localtime") WHERE id = ?',
            item.cantidad, item.precio, item.producto_id);
        }
      }

      if (compra.proveedor_id && pagado < total) {
        d.run('UPDATE proveedores SET saldo_pendiente = saldo_pendiente + ? WHERE id = ?',
          total - pagado, compra.proveedor_id);
      }
      return { id: compraId };
    });
  });

  ipcMain.handle('compras:obtenerCompras', (_, filtros = {}) => {
    let sql = `SELECT c.*, p.nombre AS proveedor_nombre FROM compras c
      LEFT JOIN proveedores p ON c.proveedor_id = p.id WHERE 1=1`;
    const params = [];
    if (filtros.desde) { sql += ' AND date(c.fecha) >= date(?)'; params.push(filtros.desde); }
    if (filtros.hasta) { sql += ' AND date(c.fecha) <= date(?)'; params.push(filtros.hasta); }
    sql += ' ORDER BY c.id DESC LIMIT 500';
    return d.all(sql, ...params);
  });

  ipcMain.handle('compras:obtenerGastos', () =>
    d.all('SELECT * FROM gastos ORDER BY fecha DESC LIMIT 200'));

  ipcMain.handle('compras:registrarGasto', (_, gasto) => {
    d.run('INSERT INTO gastos (concepto, categoria, monto, fecha, notas) VALUES (?,?,?,?,?)',
      gasto.concepto, gasto.categoria || 'general', gasto.monto,
      gasto.fecha || new Date().toISOString().replace('T', ' ').substring(0, 19),
      gasto.notas || null);
    return { id: d.lastInsertRowid() };
  });

  ipcMain.handle('compras:actualizarProveedor', (_, p) => {
    d.run('UPDATE proveedores SET nombre=?,identificacion=?,telefono=?,email=?,direccion=?,notas=? WHERE id=?',
      p.nombre, p.identificacion||null, p.telefono||null, p.email||null, p.direccion||null, p.notas||null, p.id);
    return { ok: true };
  });
}

module.exports = { register };
