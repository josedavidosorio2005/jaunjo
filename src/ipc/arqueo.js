function register(ipcMain, db) {
  const d = db.getInstance();

  // ── Abrir un nuevo turno ────────────────────────────────────────────────
  ipcMain.handle('arqueo:abrirTurno', (_, datos) => {
    // Solo puede haber un turno abierto a la vez
    const abierto = d.get("SELECT id FROM arqueos_caja WHERE estado='abierto'");
    if (abierto) throw new Error('Ya hay un turno abierto (ID: ' + abierto.id + '). Ciérralo antes de abrir uno nuevo.');

    d.run(
      `INSERT INTO arqueos_caja (usuario_id, usuario_nombre, monto_inicial, estado)
       VALUES (?, ?, ?, 'abierto')`,
      datos.usuario_id || null,
      datos.usuario_nombre || 'Desconocido',
      parseFloat(datos.monto_inicial) || 0
    );
    return { id: d.lastInsertRowid() };
  });

  // ── Cerrar turno activo ────────────────────────────────────────────────
  ipcMain.handle('arqueo:cerrarTurno', (_, datos) => {
    return d.transaction(() => {
      const turno = d.get("SELECT * FROM arqueos_caja WHERE estado='abierto'");
      if (!turno) throw new Error('No hay turno abierto para cerrar.');

      // Calcular ventas del turno (desde apertura hasta ahora)
      const resumen = d.get(`
        SELECT
          COALESCE(SUM(CASE WHEN metodo_pago='efectivo'      AND estado!='anulada' THEN total ELSE 0 END),0) AS efectivo,
          COALESCE(SUM(CASE WHEN metodo_pago='tarjeta'       AND estado!='anulada' THEN total ELSE 0 END),0) AS tarjeta,
          COALESCE(SUM(CASE WHEN metodo_pago='transferencia' AND estado!='anulada' THEN total ELSE 0 END),0) AS transferencia,
          COALESCE(SUM(CASE WHEN metodo_pago='credito'       THEN 0                ELSE 0 END),0)           AS credito,
          COALESCE(SUM(CASE WHEN estado!='anulada' THEN total ELSE 0 END),0)                                AS total
        FROM ventas
        WHERE datetime(fecha) >= datetime(?)`, turno.fecha_apertura);

      const gastosTurno = d.get(
        `SELECT COALESCE(SUM(monto),0) AS total FROM gastos
         WHERE datetime(fecha) >= datetime(?)`, turno.fecha_apertura
      ).total;

      const montoContado   = parseFloat(datos.monto_contado) || 0;
      // Efectivo esperado = inicial + ventas en efectivo - gastos
      const efectivoEsperado = turno.monto_inicial + (resumen.efectivo || 0) - gastosTurno;
      const diferencia     = +(montoContado - efectivoEsperado).toFixed(2);

      d.run(`
        UPDATE arqueos_caja SET
          fecha_cierre         = datetime('now','localtime'),
          ventas_efectivo      = ?,
          ventas_tarjeta       = ?,
          ventas_transferencia = ?,
          ventas_credito       = ?,
          total_ventas         = ?,
          gastos_turno         = ?,
          monto_contado        = ?,
          diferencia           = ?,
          estado               = 'cerrado',
          notas                = ?
        WHERE id = ?`,
        resumen.efectivo, resumen.tarjeta, resumen.transferencia, resumen.credito,
        resumen.total, gastosTurno, montoContado, diferencia,
        datos.notas || null, turno.id
      );

      return {
        id: turno.id,
        monto_inicial: turno.monto_inicial,
        ventas_efectivo: resumen.efectivo,
        ventas_tarjeta: resumen.tarjeta,
        ventas_transferencia: resumen.transferencia,
        total_ventas: resumen.total,
        gastos_turno: gastosTurno,
        efectivo_esperado: efectivoEsperado,
        monto_contado: montoContado,
        diferencia,
      };
    });
  });

  // ── Obtener turno activo (o null) ──────────────────────────────────────
  ipcMain.handle('arqueo:turnoActivo', () => {
    const turno = d.get("SELECT * FROM arqueos_caja WHERE estado='abierto'");
    if (!turno) return null;

    // Calcular totales en tiempo real
    const resumen = d.get(`
      SELECT
        COALESCE(SUM(CASE WHEN metodo_pago='efectivo'      AND estado!='anulada' THEN total ELSE 0 END),0) AS efectivo,
        COALESCE(SUM(CASE WHEN metodo_pago='tarjeta'       AND estado!='anulada' THEN total ELSE 0 END),0) AS tarjeta,
        COALESCE(SUM(CASE WHEN metodo_pago='transferencia' AND estado!='anulada' THEN total ELSE 0 END),0) AS transferencia,
        COALESCE(SUM(CASE WHEN estado!='anulada' THEN 1 ELSE 0 END),0)                                    AS cantidad,
        COALESCE(SUM(CASE WHEN estado!='anulada' THEN total ELSE 0 END),0)                                AS total
      FROM ventas WHERE datetime(fecha) >= datetime(?)`, turno.fecha_apertura);

    const gastos = d.get(
      `SELECT COALESCE(SUM(monto),0) AS total FROM gastos
       WHERE datetime(fecha) >= datetime(?)`, turno.fecha_apertura
    ).total;

    return { ...turno, live: { ...resumen, gastos } };
  });

  // ── Historial de arqueos ───────────────────────────────────────────────
  ipcMain.handle('arqueo:historial', (_, filtros = {}) => {
    const hoy   = new Date();
    const desde = filtros.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hasta = filtros.hasta || hoy.toISOString().split('T')[0];
    return d.all(`
      SELECT * FROM arqueos_caja
      WHERE date(fecha_apertura) BETWEEN date(?) AND date(?)
      ORDER BY id DESC LIMIT 100`, desde, hasta);
  });

  // ── Detalle de un arqueo ───────────────────────────────────────────────
  ipcMain.handle('arqueo:obtenerPorId', (_, id) => {
    const arq = d.get('SELECT * FROM arqueos_caja WHERE id = ?', id);
    if (!arq) return null;
    // Ventas y gastos del turno
    arq.ventas = d.all(`
      SELECT v.numero, v.fecha, v.total, v.metodo_pago, v.estado,
             c.nombre AS cliente_nombre
      FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id
      WHERE datetime(v.fecha) >= datetime(?) ${arq.fecha_cierre ? 'AND datetime(v.fecha) <= datetime(?)' : ''}
      ORDER BY v.id DESC`, ...(arq.fecha_cierre ? [arq.fecha_apertura, arq.fecha_cierre] : [arq.fecha_apertura]));
    arq.gastos_detalle = d.all(`
      SELECT * FROM gastos
      WHERE datetime(fecha) >= datetime(?) ${arq.fecha_cierre ? 'AND datetime(fecha) <= datetime(?)' : ''}
      ORDER BY id DESC`, ...(arq.fecha_cierre ? [arq.fecha_apertura, arq.fecha_cierre] : [arq.fecha_apertura]));
    return arq;
  });
}

module.exports = { register };
