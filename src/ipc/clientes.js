function register(ipcMain, db) {
  const d = db.getInstance();

  ipcMain.handle('clientes:obtenerTodos', (_, filtros = {}) => {
    let sql = 'SELECT * FROM clientes WHERE activo = 1';
    const params = [];
    if (filtros.busqueda) {
      sql += ' AND (nombre LIKE ? OR identificacion LIKE ? OR telefono LIKE ?)';
      params.push(`%${filtros.busqueda}%`, `%${filtros.busqueda}%`, `%${filtros.busqueda}%`);
    }
    sql += ' ORDER BY nombre';
    return d.all(sql, ...params);
  });

  ipcMain.handle('clientes:crearCliente', (_, c) => {
    d.run('INSERT INTO clientes (nombre,identificacion,telefono,email,direccion,notas) VALUES (?,?,?,?,?,?)',
      c.nombre, c.identificacion||null, c.telefono||null, c.email||null, c.direccion||null, c.notas||null);
    return { id: d.lastInsertRowid() };
  });

  ipcMain.handle('clientes:actualizarCliente', (_, c) => {
    d.run('UPDATE clientes SET nombre=?,identificacion=?,telefono=?,email=?,direccion=?,notas=? WHERE id=?',
      c.nombre, c.identificacion||null, c.telefono||null, c.email||null, c.direccion||null, c.notas||null, c.id);
    return { ok: true };
  });

  ipcMain.handle('clientes:eliminarCliente', (_, id) => {
    d.run('UPDATE clientes SET activo = 0 WHERE id = ?', id);
    return { ok: true };
  });

  ipcMain.handle('clientes:obtenerHistorial', (_, id) => {
    const cliente = d.get('SELECT * FROM clientes WHERE id = ?', id);
    const ventas  = d.all('SELECT * FROM ventas WHERE cliente_id = ? ORDER BY fecha DESC LIMIT 100', id);
    const pagos   = d.all('SELECT * FROM pagos_clientes WHERE cliente_id = ? ORDER BY fecha DESC', id);
    return { cliente, ventas, pagos };
  });

  ipcMain.handle('clientes:registrarPago', (_, pago) => {
    return d.transaction(() => {
      d.run('INSERT INTO pagos_clientes (cliente_id,venta_id,monto,notas) VALUES (?,?,?,?)',
        pago.cliente_id, pago.venta_id||null, pago.monto, pago.notas||null);
      const newId = d.lastInsertRowid();
      d.run('UPDATE clientes SET saldo_deuda = MAX(0, saldo_deuda - ?) WHERE id = ?',
        pago.monto, pago.cliente_id);
      if (pago.venta_id) {
        const v = d.get('SELECT total, pagado FROM ventas WHERE id = ?', pago.venta_id);
        if (v) {
          const nuevoPagado = +(v.pagado + pago.monto).toFixed(2);
          const nuevoEstado = nuevoPagado >= v.total ? 'completada' : 'credito';
          d.run('UPDATE ventas SET pagado = ?, estado = ? WHERE id = ?', nuevoPagado, nuevoEstado, pago.venta_id);
        }
      }
      return { id: newId };
    });
  });
}

module.exports = { register };
