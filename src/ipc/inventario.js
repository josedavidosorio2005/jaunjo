function register(ipcMain, db) {
  const d = db.getInstance();

  ipcMain.handle('inventario:obtenerProductos', (_, filtros = {}) => {
    let sql = `SELECT p.*, c.nombre AS categoria_nombre
      FROM productos p LEFT JOIN categorias c ON p.categoria_id = c.id WHERE p.activo = 1`;
    const params = [];
    if (filtros.busqueda) {
      sql += ' AND (p.nombre LIKE ? OR p.codigo LIKE ?)';
      params.push(`%${filtros.busqueda}%`, `%${filtros.busqueda}%`);
    }
    if (filtros.categoria_id) { sql += ' AND p.categoria_id = ?'; params.push(filtros.categoria_id); }
    sql += ' ORDER BY p.nombre';
    return d.all(sql, ...params);
  });

  ipcMain.handle('inventario:buscarPorCodigo', (_, codigo) => {
    return d.get(`SELECT p.*, c.nombre AS categoria_nombre FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id WHERE p.codigo = ? AND p.activo = 1`, codigo);
  });

  ipcMain.handle('inventario:stockBajo', () => {
    return d.all(`SELECT p.*, c.nombre AS categoria_nombre FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = 1 AND p.stock <= p.stock_minimo ORDER BY (p.stock - p.stock_minimo) ASC`);
  });

  ipcMain.handle('inventario:crearProducto', (_, prod) => {
    d.run(`INSERT INTO productos (codigo,nombre,descripcion,categoria_id,precio_compra,precio_venta,stock,stock_minimo,unidad,aplica_impuesto,imagen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      prod.codigo||null, prod.nombre, prod.descripcion||null, prod.categoria_id||null,
      prod.precio_compra||0, prod.precio_venta, prod.stock||0,
      prod.stock_minimo??5, prod.unidad||'unidad', prod.aplica_impuesto??1, prod.imagen||null);
    return { id: d.lastInsertRowid() };
  });

  ipcMain.handle('inventario:actualizarProducto', (_, prod) => {
    d.run(`UPDATE productos SET codigo=?,nombre=?,descripcion=?,categoria_id=?,precio_compra=?,
      precio_venta=?,stock=?,stock_minimo=?,unidad=?,aplica_impuesto=?,imagen=?,
      actualizado_en=datetime('now','localtime') WHERE id=?`,
      prod.codigo||null, prod.nombre, prod.descripcion||null, prod.categoria_id||null,
      prod.precio_compra||0, prod.precio_venta, prod.stock, prod.stock_minimo??5,
      prod.unidad||'unidad', prod.aplica_impuesto??1, prod.imagen||null, prod.id);
    return { ok: true };
  });

  ipcMain.handle('inventario:eliminarProducto', (_, id) => {
    d.run("UPDATE productos SET activo = 0 WHERE id = ?", id);
    return { ok: true };
  });

  ipcMain.handle('inventario:obtenerCategorias', () => {
    return d.all('SELECT * FROM categorias ORDER BY nombre');
  });

  ipcMain.handle('inventario:crearCategoria', (_, cat) => {
    d.run('INSERT INTO categorias (nombre,descripcion,color) VALUES (?,?,?)',
      cat.nombre, cat.descripcion||null, cat.color||'#6366f1');
    return { id: d.lastInsertRowid() };
  });
}

module.exports = { register };
