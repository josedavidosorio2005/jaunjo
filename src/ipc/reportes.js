function register(ipcMain, db) {
  const d = db.getInstance();

  ipcMain.handle('reportes:ventasPorPeriodo', (_, filtros = {}) => {
    const hoy  = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];

    const resumen = d.get(`SELECT COUNT(*) AS cantidad,
      COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(CASE WHEN estado='completada' THEN total ELSE 0 END),0) AS cobrado,
      COALESCE(SUM(CASE WHEN estado='credito' THEN total-pagado ELSE 0 END),0) AS pendiente,
      COALESCE(SUM(CASE WHEN metodo_pago='efectivo' THEN total ELSE 0 END),0) AS efectivo,
      COALESCE(SUM(CASE WHEN metodo_pago='tarjeta' THEN total ELSE 0 END),0) AS tarjeta
      FROM ventas WHERE estado != 'anulada' AND date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta);

    const porDia = d.all(`SELECT date(fecha) as dia, COUNT(*) as ventas, SUM(total) as total
      FROM ventas WHERE estado != 'anulada' AND date(fecha) BETWEEN date(?) AND date(?)
      GROUP BY date(fecha) ORDER BY dia`, desde, hasta);

    return { resumen, porDia, desde, hasta };
  });

  ipcMain.handle('reportes:balanceGeneral', (_, filtros = {}) => {
    const hoy  = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];

    const ingresos = d.get(`SELECT COALESCE(SUM(total),0) AS total FROM ventas
      WHERE estado != 'anulada' AND date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta).total;
    const eg_compras = d.get(`SELECT COALESCE(SUM(total),0) AS total FROM compras
      WHERE date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta).total;
    const eg_gastos  = d.get(`SELECT COALESCE(SUM(monto),0) AS total FROM gastos
      WHERE date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta).total;
    const egresos = +(eg_compras + eg_gastos).toFixed(2);
    return { ingresos, egresos, egresos_compras: eg_compras, egresos_gastos: eg_gastos,
             utilidad: +(ingresos - egresos).toFixed(2), desde, hasta };
  });

  ipcMain.handle('reportes:productosMasVendidos', (_, filtros = {}) => {
    const hoy  = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];
    return d.all(`SELECT vd.nombre, SUM(vd.cantidad) AS cantidad_total, SUM(vd.total) AS total_vendido
      FROM ventas_detalle vd JOIN ventas v ON vd.venta_id = v.id
      WHERE v.estado != 'anulada' AND date(v.fecha) BETWEEN date(?) AND date(?)
      GROUP BY vd.nombre ORDER BY cantidad_total DESC LIMIT 10`, desde, hasta);
  });

  ipcMain.handle('reportes:clientesTop', () => {
    return d.all(`SELECT c.nombre, COUNT(v.id) AS compras, COALESCE(SUM(v.total),0) AS total_comprado
      FROM clientes c LEFT JOIN ventas v ON c.id = v.cliente_id AND v.estado != 'anulada'
      WHERE c.activo = 1 GROUP BY c.id ORDER BY total_comprado DESC LIMIT 10`);
  });

  ipcMain.handle('reportes:flujoEfectivo', (_, filtros = {}) => {
    const hoy  = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];
    const entradas = d.all(`SELECT date(fecha) AS fecha,'venta' AS tipo,numero AS referencia,total AS monto
      FROM ventas WHERE estado != 'anulada' AND date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta);
    const salidas_c = d.all(`SELECT date(fecha) AS fecha,'compra' AS tipo,COALESCE(numero,'') AS referencia,total AS monto
      FROM compras WHERE date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta);
    const salidas_g = d.all(`SELECT date(fecha) AS fecha,'gasto' AS tipo,concepto AS referencia,monto
      FROM gastos WHERE date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta);
    return { entradas, salidas: [...salidas_c, ...salidas_g], desde, hasta };
  });

  // ─── Estado de Resultados (P&L) ─────────────────────────────────────────────
  ipcMain.handle('reportes:estadoResultados', (_, filtros = {}) => {
    const hoy  = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];

    const ventas = d.get(`
      SELECT COUNT(*) AS cantidad,
        COALESCE(SUM(total),0) AS total_ventas,
        COALESCE(SUM(descuento),0) AS total_descuentos,
        COALESCE(SUM(CASE WHEN metodo_pago='efectivo'      THEN total ELSE 0 END),0) AS efectivo,
        COALESCE(SUM(CASE WHEN metodo_pago='transferencia' THEN total ELSE 0 END),0) AS transferencia,
        COALESCE(SUM(CASE WHEN metodo_pago='tarjeta'       THEN total ELSE 0 END),0) AS tarjeta
      FROM ventas WHERE estado != 'anulada'
        AND date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta);

    const cmv_row = d.get(`
      SELECT COALESCE(SUM(vd.cantidad * COALESCE(p.precio_compra, 0)), 0) AS cmv
      FROM ventas_detalle vd
      JOIN ventas v ON vd.venta_id = v.id
      LEFT JOIN productos p ON vd.producto_id = p.id
      WHERE v.estado != 'anulada'
        AND date(v.fecha) BETWEEN date(?) AND date(?)`, desde, hasta);

    const gastos = d.all(`
      SELECT categoria, COALESCE(SUM(monto),0) AS total
      FROM gastos WHERE date(fecha) BETWEEN date(?) AND date(?)
      GROUP BY categoria ORDER BY total DESC`, desde, hasta);

    const total_gastos = +gastos.reduce((s,g) => s+g.total, 0).toFixed(2);

    const compras = d.get(`
      SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
      FROM compras WHERE date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta);

    const anuladas = d.get(`
      SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
      FROM ventas WHERE estado='anulada'
        AND date(fecha) BETWEEN date(?) AND date(?)`, desde, hasta);

    const cmv            = +(cmv_row.cmv).toFixed(2);
    const ventas_netas   = +(ventas.total_ventas - ventas.total_descuentos).toFixed(2);
    const utilidad_bruta = +(ventas_netas - cmv).toFixed(2);
    const margen_bruto   = ventas_netas > 0 ? +((utilidad_bruta / ventas_netas) * 100).toFixed(1) : 0;
    const utilidad_neta  = +(utilidad_bruta - total_gastos).toFixed(2);
    const margen_neto    = ventas_netas > 0 ? +((utilidad_neta / ventas_netas) * 100).toFixed(1) : 0;

    return { desde, hasta, ventas, ventas_netas, cmv, utilidad_bruta, margen_bruto,
             gastos, total_gastos, utilidad_neta, margen_neto, compras, anuladas };
  });

  // ─── Ganancias brutas por producto ──────────────────────────────────────────
  ipcMain.handle('reportes:gananciasPorProducto', (_, filtros = {}) => {
    const hoy  = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];
    return d.all(`
      SELECT
        vd.nombre,
        COALESCE(p.codigo, '') AS codigo,
        COALESCE(cat.nombre, 'Sin categoría') AS categoria,
        SUM(vd.cantidad) AS qty_vendida,
        ROUND(AVG(vd.precio), 2) AS precio_venta_prom,
        COALESCE(p.precio_compra, 0) AS precio_compra,
        ROUND(SUM(vd.total), 2) AS ingreso_total,
        ROUND(SUM(vd.cantidad * COALESCE(p.precio_compra, 0)), 2) AS costo_total,
        ROUND(SUM(vd.total - vd.cantidad * COALESCE(p.precio_compra, 0)), 2) AS ganancia,
        CASE WHEN SUM(vd.total) > 0
          THEN ROUND((SUM(vd.total - vd.cantidad * COALESCE(p.precio_compra,0)) / SUM(vd.total)) * 100, 1)
          ELSE 0 END AS margen_pct
      FROM ventas_detalle vd
      JOIN ventas v ON vd.venta_id = v.id
      LEFT JOIN productos p ON vd.producto_id = p.id
      LEFT JOIN categorias cat ON p.categoria_id = cat.id
      WHERE v.estado != 'anulada'
        AND date(v.fecha) BETWEEN date(?) AND date(?)
      GROUP BY vd.nombre
      ORDER BY ganancia DESC`, desde, hasta);
  });

  // ─── Libros contables completos ──────────────────────────────────────────────
  ipcMain.handle('reportes:libroContable', (_, filtros = {}) => {
    const hoy  = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];

    const ventas = d.all(`
      SELECT v.numero, date(v.fecha) AS fecha,
             COALESCE(c.nombre, 'Consumidor Final') AS cliente,
             v.subtotal, v.descuento, v.impuesto, v.total,
             v.metodo_pago, v.estado,
             COALESCE(v.notas, '') AS notas
      FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
      ORDER BY v.fecha DESC`, desde, hasta);

    const compras = d.all(`
      SELECT c.numero, date(c.fecha) AS fecha,
             COALESCE(p.nombre, 'Sin proveedor') AS proveedor,
             c.subtotal, c.impuesto, c.total, c.pagado, c.estado,
             COALESCE(c.notas, '') AS notas
      FROM compras c LEFT JOIN proveedores p ON c.proveedor_id = p.id
      WHERE date(c.fecha) BETWEEN date(?) AND date(?)
      ORDER BY c.fecha DESC`, desde, hasta);

    const gastos = d.all(`
      SELECT date(fecha) AS fecha, concepto, categoria, monto,
             COALESCE(notas, '') AS notas
      FROM gastos WHERE date(fecha) BETWEEN date(?) AND date(?)
      ORDER BY fecha DESC`, desde, hasta);

    return { ventas, compras, gastos, desde, hasta };
  });
}

module.exports = { register };
