/**
 * ContaFlex — Servidor Web Principal
 * Permite que múltiples trabajadores se conecten vía navegador/móvil
 * usando la misma base de datos de la aplicación Electron.
 */
const http    = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const crypto  = require('path') && require('crypto');
const path    = require('path');
const os      = require('os');

const TOKEN_SECRET = 'contaflex_srv_2026';
const TOKEN_TTL    = 10 * 60 * 60 * 1000; // 10 horas
const DEFAULT_PORT = 3535;

let _db      = null;
let _server  = null;
let _wss     = null;
let _port    = DEFAULT_PORT;
let _clients = new Set();

// ─── Utilidades ──────────────────────────────────────────────────────────────

function hashPassword(pwd) {
  return crypto.createHash('sha256').update('contaflex2026::' + pwd).digest('hex');
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig  = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const sig  = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  try {
    const bExp = Buffer.from(expected);
    const bSig = Buffer.from(sig);
    if (bExp.length !== bSig.length || !crypto.timingSafeEqual(bExp, bSig)) return null;
  } catch { return null; }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (Date.now() - payload.iat > TOKEN_TTL) return null;
  return payload;
}

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(ifaces)) {
    for (const a of iface) {
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
  }
  return ips;
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const ws of _clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ─── Middleware auth ──────────────────────────────────────────────────────────

function auth(req, res, next) {
  const hdr   = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.query._t;
  const user  = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

// ─── Arranque del servidor ────────────────────────────────────────────────────

function start(db, port) {
  if (_server) return getStatus();
  _db   = db.getInstance();
  _port = port || DEFAULT_PORT;

  const app = express();

  // Seguridad básica: cabeceras
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  // Servir cliente web estático
  app.use(express.static(path.join(__dirname, 'public')));

  // ── PUBLIC ────────────────────────────────────────────────────────────────

  /** Info pública del negocio (nombre, moneda) */
  app.get('/api/info', (req, res) => {
    const rows = _db.all('SELECT clave, valor FROM config');
    const cfg  = {};
    for (const r of rows) cfg[r.clave] = r.valor;
    res.json({
      nombre:  cfg.nombre_negocio  || 'ContaFlex',
      moneda:  cfg.simbolo_moneda  || '$',
      logo:    cfg.logo_url        || null,
    });
  });

  /** Login → devuelve JWT */
  app.post('/api/auth/login', (req, res) => {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) return res.status(400).json({ error: 'Campos requeridos' });
    const hash = hashPassword(String(password));
    const user = _db.get(
      'SELECT id, nombre, usuario, rol FROM usuarios WHERE usuario=? AND password_hash=? AND activo=1',
      String(usuario).toLowerCase(), hash
    );
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = signToken({ id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol });
    res.json({ token, user: { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol } });
  });

  // ── PROTECTED ─────────────────────────────────────────────────────────────
  app.use('/api', auth);

  /** Renovar token */
  app.get('/api/auth/renew', (req, res) => {
    const token = signToken({ id: req.user.id, nombre: req.user.nombre, usuario: req.user.usuario, rol: req.user.rol });
    res.json({ token });
  });

  // ── Productos / Catálogo ──
  app.get('/api/productos', (req, res) => {
    const { busqueda, categoria_id } = req.query;
    let sql = `SELECT p.*, c.nombre AS categoria_nombre
      FROM productos p LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = 1`;
    const params = [];
    if (busqueda) {
      sql += ' AND (p.nombre LIKE ? OR p.codigo LIKE ?)';
      params.push(`%${busqueda}%`, `%${busqueda}%`);
    }
    if (categoria_id) { sql += ' AND p.categoria_id = ?'; params.push(categoria_id); }
    sql += ' ORDER BY p.nombre';
    res.json(_db.all(sql, ...params));
  });

  app.get('/api/categorias', (req, res) => {
    res.json(_db.all('SELECT * FROM categorias ORDER BY nombre'));
  });

  // ── Ventas ──
  app.get('/api/ventas', (req, res) => {
    const { desde, hasta, estado } = req.query;
    let sql = `SELECT v.*, c.nombre AS cliente_nombre
      FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id WHERE 1=1`;
    const params = [];
    if (desde) { sql += ' AND date(v.fecha) >= date(?)'; params.push(desde); }
    if (hasta) { sql += ' AND date(v.fecha) <= date(?)'; params.push(hasta); }
    if (estado) { sql += ' AND v.estado = ?'; params.push(estado); }
    sql += ' ORDER BY v.id DESC LIMIT 200';
    res.json(_db.all(sql, ...params));
  });

  app.get('/api/ventas/hoy', (req, res) => {
    const hoy = new Date().toISOString().split('T')[0];
    res.json(_db.get(
      `SELECT COUNT(*) AS total_ventas, COALESCE(SUM(total),0) AS total_ingresos
       FROM ventas WHERE date(fecha) = date(?)`, hoy
    ));
  });

  app.get('/api/ventas/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const venta = _db.get(
      `SELECT v.*, c.nombre AS cliente_nombre
       FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id WHERE v.id = ?`, id);
    if (!venta) return res.status(404).json({ error: 'No encontrado' });
    venta.detalle = _db.all('SELECT * FROM ventas_detalle WHERE venta_id = ?', id);
    res.json(venta);
  });

  app.post('/api/ventas', (req, res) => {
    try {
      const venta = req.body;
      if (!venta || !Array.isArray(venta.detalle) || venta.detalle.length === 0)
        return res.status(400).json({ error: 'Detalle de venta requerido' });

      const result = _db.transaction(() => {
        const cfg    = _db.get("SELECT valor FROM config WHERE clave='prefijo_factura'");
        const numRow = _db.get("SELECT valor FROM config WHERE clave='siguiente_numero'");
        const prefijo = cfg ? cfg.valor : 'FAC-';
        const num     = numRow ? parseInt(numRow.valor) : 1;
        const numero  = `${prefijo}${String(num).padStart(6, '0')}`;

        const subtotal  = venta.detalle.reduce((s, i) => s + (i.total || 0), 0);
        const impPct    = parseFloat(_db.get("SELECT valor FROM config WHERE clave='impuesto_porcentaje'")?.valor || 0);
        const aplicaImp = _db.get("SELECT valor FROM config WHERE clave='aplicar_impuesto'")?.valor === '1';
        const impuesto  = aplicaImp ? +((subtotal) * impPct / 100).toFixed(2) : 0;
        const descuento = venta.descuento || 0;
        const total     = +(subtotal + impuesto - descuento).toFixed(2);
        const pagado    = venta.pagado ?? total;

        _db.run(
          `INSERT INTO ventas (numero,cliente_id,subtotal,descuento,impuesto,total,pagado,metodo_pago,estado,notas)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          numero,
          venta.cliente_id || null,
          subtotal, descuento, impuesto, total, pagado,
          venta.metodo_pago || 'efectivo',
          pagado < total ? 'credito' : 'completada',
          venta.notas || null
        );
        const ventaId = _db.lastInsertRowid();

        for (const item of venta.detalle) {
          _db.run(
            `INSERT INTO ventas_detalle (venta_id,producto_id,nombre,cantidad,precio,descuento,total)
             VALUES (?,?,?,?,?,?,?)`,
            ventaId,
            item.producto_id || null,
            item.nombre, item.cantidad, item.precio,
            item.descuento || 0, item.total
          );
          if (item.producto_id) {
            _db.run(
              'UPDATE productos SET stock = stock - ?, actualizado_en = datetime("now","localtime") WHERE id = ?',
              item.cantidad, item.producto_id
            );
          }
        }

        if (venta.cliente_id && pagado < total) {
          _db.run(
            'UPDATE clientes SET saldo_deuda = saldo_deuda + ? WHERE id = ?',
            +(total - pagado).toFixed(2), venta.cliente_id
          );
        }

        _db.run("UPDATE config SET valor = ? WHERE clave = 'siguiente_numero'", String(num + 1));
        return { id: ventaId, numero, total, subtotal, impuesto, descuento, pagado };
      });

      // Notificar a TODOS los clientes conectados (app Electron + otros navegadores)
      broadcast('venta:nueva', {
        id: result.id, numero: result.numero, total: result.total,
        usuario: req.user.nombre, rol: req.user.rol
      });

      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Clientes ──
  app.get('/api/clientes', (req, res) => {
    const { busqueda } = req.query;
    let sql = 'SELECT id, nombre, telefono, saldo_deuda FROM clientes WHERE activo = 1';
    const params = [];
    if (busqueda) {
      sql += ' AND (nombre LIKE ? OR telefono LIKE ?)';
      params.push(`%${busqueda}%`, `%${busqueda}%`);
    }
    sql += ' ORDER BY nombre LIMIT 100';
    res.json(_db.all(sql, ...params));
  });

  app.post('/api/clientes', (req, res) => {
    const c = req.body || {};
    if (!c.nombre) return res.status(400).json({ error: 'Nombre requerido' });
    _db.run(
      'INSERT INTO clientes (nombre,identificacion,telefono,email,direccion,notas) VALUES (?,?,?,?,?,?)',
      c.nombre, c.identificacion || null, c.telefono || null,
      c.email || null, c.direccion || null, c.notas || null
    );
    res.status(201).json({ id: _db.lastInsertRowid() });
  });

  // ── Config (solo admin) ──
  app.get('/api/config', adminOnly, (req, res) => {
    const rows = _db.all('SELECT clave, valor FROM config');
    const cfg  = {};
    for (const r of rows) cfg[r.clave] = r.valor;
    res.json(cfg);
  });

  // ── Estado del servidor ──
  app.get('/api/status', (req, res) => {
    res.json({ ok: true, clients: _clients.size, uptime: Math.floor(process.uptime()) });
  });

  // ─── HTTP + WebSocket ────────────────────────────────────────────────────
  _server = http.createServer(app);
  _wss    = new WebSocketServer({ server: _server });

  _wss.on('connection', (ws, req) => {
    const url   = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const user  = verifyToken(token);
    if (!user) { ws.close(1008, 'No autorizado'); return; }

    ws.user = user;
    _clients.add(ws);

    ws.send(JSON.stringify({
      type: 'connected',
      data: { usuario: user.nombre, rol: user.rol, serverTime: Date.now() }
    }));

    ws.on('close',   () => _clients.delete(ws));
    ws.on('error',   () => _clients.delete(ws));

    // Ping/pong para mantener conexión viva
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      } catch {}
    });
  });

  _server.listen(_port, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log(`[ContaFlex] Servidor iniciado → puerto ${_port}`);
    ips.forEach(ip => console.log(`  → http://${ip}:${_port}`));
  });

  _server.on('error', (err) => {
    console.error('[ContaFlex] Error en servidor:', err.message);
    _server = null;
    _wss    = null;
  });

  return getStatus();
}

function stop() {
  if (!_server) return;
  for (const ws of _clients) ws.close();
  _clients.clear();
  _wss.close();
  _server.close();
  _server = null;
  _wss    = null;
  console.log('[ContaFlex] Servidor detenido');
}

function getStatus() {
  const ips = getLocalIPs();
  const primaryUrl = ips.length > 0 ? `http://${ips[0]}:${_port}` : `http://localhost:${_port}`;
  return {
    running:    !!_server,
    port:       _port,
    ips,
    urls:       ips.map(ip => `http://${ip}:${_port}`),
    primaryUrl,
    clients:    _clients.size,
  };
}

module.exports = { start, stop, getStatus, broadcast };
