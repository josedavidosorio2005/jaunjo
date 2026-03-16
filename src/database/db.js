/**
 * ContaFlex — Base de datos con sql.js (SQLite en WebAssembly, sin compilación nativa)
 */
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

let SQL;
let db;
let _inTransaction = false;
let _saveTimer     = null;

// Guarda la BD como máximo una vez cada 800ms para no bloquear el hilo
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; _flushSave(); }, 800);
}

function _flushSave() {
  const data = db.export();
  fs.writeFileSync(getDbPath(), Buffer.from(data));
}

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'contaflex.db');
}

async function init() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '../../node_modules/sql.js/dist', file)
  });

  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  // PRAGMAs de rendimiento (sql.js es in-memory, pero mejoran las queries compiladas)
  dbRun('PRAGMA foreign_keys = ON');
  dbRun('PRAGMA journal_mode = MEMORY');
  dbRun('PRAGMA synchronous = OFF');
  dbRun('PRAGMA cache_size = -8000');  // 8 MB de caché de páginas
  dbRun('PRAGMA temp_store = MEMORY');
  createTables();
  crearIndices();
  insertarDatosIniciales();
  insertarUsuariosIniciales();
  return db;
}

function save(force = false) {
  if (force || _inTransaction) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    _flushSave();
  } else {
    scheduleSave();
  }
}

// API pública — compatible con el patrón usado en los IPC handlers
function dbRun(sql, params = []) {
  db.run(sql, params);
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbExec(s) { db.exec(s); }

function dbTransaction(fn) {
  _inTransaction = true;
  dbRun('BEGIN');
  try {
    const r = fn();
    dbRun('COMMIT');
    _inTransaction = false;
    save();
    return r;
  } catch (e) {
    dbRun('ROLLBACK');
    _inTransaction = false;
    throw e;
  }
}

function dbLastId() {
  return dbGet('SELECT last_insert_rowid() as id').id;
}

// getInstance retorna un objeto con la misma API que usamos en los handlers IPC
function getInstance() {
  return {
    run: (sql, ...params) => { dbRun(sql, params.flat()); if (!_inTransaction) save(); /* diferido */ },
    forceSave: () => save(true),
    get: (sql, ...params) => dbGet(sql, params.flat()),
    all: (sql, ...params) => dbAll(sql, params.flat()),
    exec: (s) => { dbExec(s); if (!_inTransaction) save(); },
    transaction: dbTransaction,
    lastInsertRowid: dbLastId,
    prepare: (sql) => ({
      run:  (...params) => { dbRun(sql, params.flat()); if (!_inTransaction) save(); return { lastInsertRowid: dbLastId() }; },
      get:  (...params) => dbGet(sql, params.flat()),
      all:  (...params) => dbAll(sql, params.flat()),
      step: () => { dbRun(sql); }
    })
  };
}

function crearIndices() {
  db.exec(`
    -- Ventas: las queries más frecuentes filtran por fecha y estado
    CREATE INDEX IF NOT EXISTS idx_ventas_fecha    ON ventas(date(fecha));
    CREATE INDEX IF NOT EXISTS idx_ventas_estado   ON ventas(estado);
    CREATE INDEX IF NOT EXISTS idx_ventas_cliente  ON ventas(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_ventas_numero   ON ventas(numero);

    -- Detalle de ventas: joins frecuentes por venta_id y producto_id
    CREATE INDEX IF NOT EXISTS idx_vdet_venta      ON ventas_detalle(venta_id);
    CREATE INDEX IF NOT EXISTS idx_vdet_producto   ON ventas_detalle(producto_id);

    -- Productos: búsquedas por nombre, código, categoría y activo
    CREATE INDEX IF NOT EXISTS idx_prod_nombre     ON productos(nombre);
    CREATE INDEX IF NOT EXISTS idx_prod_codigo     ON productos(codigo);
    CREATE INDEX IF NOT EXISTS idx_prod_categoria  ON productos(categoria_id);
    CREATE INDEX IF NOT EXISTS idx_prod_activo     ON productos(activo);

    -- Compras / gastos: filtros por fecha
    CREATE INDEX IF NOT EXISTS idx_compras_fecha   ON compras(date(fecha));
    CREATE INDEX IF NOT EXISTS idx_gastos_fecha    ON gastos(date(fecha));

    -- Clientes: búsqueda por nombre
    CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);
  `);
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);

    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL,
      descripcion TEXT, color TEXT DEFAULT '#6366f1',
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE, nombre TEXT NOT NULL,
      descripcion TEXT, categoria_id INTEGER REFERENCES categorias(id),
      precio_compra REAL DEFAULT 0, precio_venta REAL NOT NULL DEFAULT 0,
      stock REAL DEFAULT 0, stock_minimo REAL DEFAULT 5, unidad TEXT DEFAULT 'unidad',
      aplica_impuesto INTEGER DEFAULT 1, imagen TEXT, activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now','localtime')),
      actualizado_en TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL,
      identificacion TEXT, telefono TEXT, email TEXT, direccion TEXT,
      saldo_deuda REAL DEFAULT 0, notas TEXT, activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS proveedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL,
      identificacion TEXT, telefono TEXT, email TEXT, direccion TEXT,
      saldo_pendiente REAL DEFAULT 0, notas TEXT, activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT UNIQUE,
      cliente_id INTEGER REFERENCES clientes(id),
      fecha TEXT DEFAULT (datetime('now','localtime')),
      subtotal REAL DEFAULT 0, descuento REAL DEFAULT 0, impuesto REAL DEFAULT 0,
      total REAL DEFAULT 0, pagado REAL DEFAULT 0, metodo_pago TEXT DEFAULT 'efectivo',
      estado TEXT DEFAULT 'completada', notas TEXT,
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ventas_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER NOT NULL REFERENCES ventas(id),
      producto_id INTEGER REFERENCES productos(id), nombre TEXT NOT NULL,
      cantidad REAL NOT NULL DEFAULT 1, precio REAL NOT NULL DEFAULT 0,
      descuento REAL DEFAULT 0, total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT,
      proveedor_id INTEGER REFERENCES proveedores(id),
      fecha TEXT DEFAULT (datetime('now','localtime')),
      subtotal REAL DEFAULT 0, impuesto REAL DEFAULT 0, total REAL DEFAULT 0,
      pagado REAL DEFAULT 0, estado TEXT DEFAULT 'pagada', notas TEXT,
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS compras_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER NOT NULL REFERENCES compras(id),
      producto_id INTEGER REFERENCES productos(id), nombre TEXT NOT NULL,
      cantidad REAL NOT NULL DEFAULT 1, precio REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, concepto TEXT NOT NULL,
      categoria TEXT DEFAULT 'general', monto REAL NOT NULL DEFAULT 0,
      fecha TEXT DEFAULT (datetime('now','localtime')), notas TEXT
    );

    CREATE TABLE IF NOT EXISTS pagos_clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      venta_id INTEGER REFERENCES ventas(id), monto REAL NOT NULL DEFAULT 0,
      fecha TEXT DEFAULT (datetime('now','localtime')), notas TEXT
    );

    CREATE TABLE IF NOT EXISTS arqueos_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      usuario_nombre TEXT,
      fecha_apertura TEXT DEFAULT (datetime('now','localtime')),
      fecha_cierre  TEXT,
      monto_inicial REAL DEFAULT 0,
      ventas_efectivo REAL DEFAULT 0,
      ventas_tarjeta  REAL DEFAULT 0,
      ventas_transferencia REAL DEFAULT 0,
      ventas_credito  REAL DEFAULT 0,
      total_ventas    REAL DEFAULT 0,
      gastos_turno    REAL DEFAULT 0,
      monto_contado   REAL DEFAULT 0,
      diferencia      REAL DEFAULT 0,
      estado TEXT DEFAULT 'abierto',
      notas TEXT
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'mesero',
      activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
  save();
}

function insertarDatosIniciales() {
  const existe = dbGet("SELECT 1 AS ok FROM config WHERE clave='nombre_negocio'");
  if (existe) {
    // DB ya existente: solo correr sembrado de datos demo si falta
    sembrarDatosDemo();
    return;
  }

  // Base mínima para DB nueva
  dbRun('BEGIN');
  [
    ['nombre_negocio','Despensa El Buen Precio'],
    ['moneda','USD'],['simbolo_moneda','$'],
    ['impuesto_porcentaje','0'],['aplicar_impuesto','0'],
    ['tipo_negocio','tienda'],
    ['modulos_activos',JSON.stringify(['ventas','inventario','clientes','compras','reportes'])],
    ['prefijo_factura','FAC-'],['siguiente_numero','1'],
    ['color_primario','#6366f1'],['tema','dark']
  ].forEach(([k,v]) => dbRun("INSERT OR IGNORE INTO config (clave,valor) VALUES (?,?)", [k,v]));

  dbRun("INSERT INTO clientes (nombre,telefono) VALUES (?,?)", ['Cliente General','N/A']);
  dbRun('COMMIT');
  save();

  sembrarDatosDemo();
}

// ─── Datos de demostración realistas ─────────────────────────────────────────
function sembrarDatosDemo() {
  const yaHecho = dbGet("SELECT 1 AS ok FROM config WHERE clave='datos_demo_sembrados'");
  if (yaHecho) return;

  try {
    dbRun('BEGIN');

    // Helper: fecha N días atrás
    function dga(n, h) {
      const d = new Date(); d.setDate(d.getDate() - n);
      return d.toISOString().split('T')[0] + ' ' + (h || '10:00:00');
    }

    // Actualizar nombre si sigue siendo el default
    const nmAct = dbGet("SELECT valor FROM config WHERE clave='nombre_negocio'")?.valor;
    if (!nmAct || nmAct === 'Mi Negocio') {
      dbRun("INSERT OR REPLACE INTO config (clave,valor) VALUES ('nombre_negocio','Despensa El Buen Precio')");
    }
    // Desactivar impuesto (precios finales en esta demo)
    dbRun("INSERT OR REPLACE INTO config (clave,valor) VALUES ('aplicar_impuesto','0')");

    // ── Categorías ─────────────────────────────────────────────────────────
    [
      ['Alimentos Básicos', 'Granos, conservas y abarrotes', '#22c55e'],
      ['Bebidas',           'Agua, jugos y refrescos',       '#3b82f6'],
      ['Lácteos y Fríos',   'Leche, queso, yoghurt',         '#0ea5e9'],
      ['Limpieza y Hogar',  'Detergentes, desinfectantes',   '#f59e0b'],
      ['Higiene Personal',  'Champú, jabón, pasta dental',   '#ec4899'],
      ['Snacks y Dulces',   'Galletas, chips, chocolatinas', '#a855f7'],
    ].forEach(([n, d, c]) => {
      if (!dbGet("SELECT id FROM categorias WHERE nombre=?", [n]))
        dbRun("INSERT INTO categorias (nombre,descripcion,color) VALUES (?,?,?)", [n,d,c]);
    });

    const gcat = n => dbGet("SELECT id FROM categorias WHERE nombre=?", [n])?.id || 1;

    // ── Productos ──────────────────────────────────────────────────────────
    // [codigo, nombre, cat_fn, p_compra, p_venta, stock, stock_min, unidad]
    [
      ['ALI001','Arroz Integral 1kg',      'Alimentos Básicos', 0.80, 1.20, 50,10,'kg'],
      ['ALI002','Harina PAN 1kg',           'Alimentos Básicos', 0.90, 1.30, 40,10,'kg'],
      ['ALI003','Pasta Larga 500g',         'Alimentos Básicos', 0.60, 0.90, 60,10,'und'],
      ['ALI004','Aceite Vegetal 1L',        'Alimentos Básicos', 2.50, 3.50, 30, 5,'L'],
      ['ALI005','Azúcar Refinada 1kg',      'Alimentos Básicos', 0.70, 1.00, 45,10,'kg'],
      ['ALI006','Sal Marina 1kg',           'Alimentos Básicos', 0.30, 0.50, 40, 8,'kg'],
      ['ALI007','Caraotas Negras 500g',     'Alimentos Básicos', 0.80, 1.20, 35, 8,'und'],
      ['ALI008','Atún en Lata 300g',        'Alimentos Básicos', 1.50, 2.20, 25, 5,'und'],
      ['BEB001','Agua Mineral 500ml',       'Bebidas',           0.40, 0.75, 80,12,'und'],
      ['BEB002','Refresco Cola 400ml',      'Bebidas',           0.60, 1.00, 50,10,'und'],
      ['BEB003','Jugo de Naranja 1L',       'Bebidas',           1.20, 2.00, 30, 6,'L'],
      ['BEB004','Malta 330ml',              'Bebidas',           0.80, 1.20, 40,10,'und'],
      ['LAC001','Leche Pasteurizada 1L',    'Lácteos y Fríos',   1.30, 1.80, 35, 8,'L'],
      ['LAC002','Queso Blanco 500g',        'Lácteos y Fríos',   3.00, 4.50, 15, 4,'und'],
      ['LAC003','Yoghurt Natural 1kg',      'Lácteos y Fríos',   2.00, 3.00, 20, 4,'und'],
      ['LAC004','Mantequilla 250g',         'Lácteos y Fríos',   2.50, 3.50, 12, 3,'und'],
      ['LIM001','Jabón de Lavar 250g',      'Limpieza y Hogar',  0.60, 1.00, 30, 6,'und'],
      ['LIM002','Detergente en Polvo 500g', 'Limpieza y Hogar',  1.20, 1.80, 25, 5,'und'],
      ['LIM003','Blanqueador 1L',           'Limpieza y Hogar',  0.90, 1.40, 20, 5,'L'],
      ['HIG001','Champú 2en1 400ml',        'Higiene Personal',  2.00, 3.20, 18, 4,'und'],
      ['HIG002','Jabón de Baño 150g',       'Higiene Personal',  0.60, 1.00, 35, 8,'und'],
      ['HIG003','Pasta Dental 100ml',       'Higiene Personal',  1.50, 2.30, 20, 5,'und'],
      ['SNK001','Galletas Soda 240g',       'Snacks y Dulces',   1.00, 1.60, 25, 6,'und'],
      ['SNK002','Chips de Maíz 80g',        'Snacks y Dulces',   0.80, 1.30, 30, 8,'und'],
      ['SNK003','Chocolatina 30g',          'Snacks y Dulces',   0.40, 0.75, 45,10,'und'],
    ].forEach(([cod,nom,cat,pc,pv,stk,stkm,uni]) =>
      dbRun(`INSERT OR IGNORE INTO productos
             (codigo,nombre,categoria_id,precio_compra,precio_venta,stock,stock_minimo,unidad,aplica_impuesto)
             VALUES (?,?,?,?,?,?,?,?,0)`, [cod,nom,gcat(cat),pc,pv,stk,stkm,uni]));

    // ── Clientes ───────────────────────────────────────────────────────────
    [
      ['María González', 'V-18456789','0414-123-4567','maria.gonzalez@gmail.com', 'Calle Bolívar, Casa 12'],
      ['Carlos Pérez',   'V-12345678','0424-234-5678','',                         'Av. Principal, Apto 3-B'],
      ['Ana Martínez',   'V-20123456','0412-345-6789','ana.martinez@gmail.com',   'Urb. Las Flores, #5'],
      ['José Rodríguez', 'V-15678901','0416-456-7890','',                         'Sector El Centro, Local 2'],
      ['Familia López',  'V-10987654','0426-567-8901','',                         'Calle Los Mangos, local 8'],
      ['Pedro Sánchez',  'V-22334455','0414-678-9012','pedro.sanchez@hotmail.com','Res. El Parque, Piso 2'],
    ].forEach(([n,id,tel,em,dir]) => {
      if (!dbGet("SELECT id FROM clientes WHERE nombre=?", [n]))
        dbRun("INSERT INTO clientes (nombre,identificacion,telefono,email,direccion) VALUES (?,?,?,?,?)",[n,id,tel,em,dir]);
    });

    // ── Proveedores ────────────────────────────────────────────────────────
    [
      ['Distribuidora Polar',    'J-00003827-8','0212-900-1111','ventas@polar.com.ve',  'Caracas, Zona Industrial'],
      ['Lácteos Los Andes',      'J-29456123-4','0274-800-2222','pedidos@lacteos.com',  'Mérida, Sector Industrial'],
      ['Importadora Todo Hogar', 'J-30112345-5','0412-700-3333','',                     'Valencia, Av. Bolívar Norte'],
      ['Distribuidora El Parque','J-14567890-1','0414-600-4444','compras@elparque.com', 'Caracas, El Llanito'],
    ].forEach(([n,id,tel,em,dir]) => {
      if (!dbGet("SELECT id FROM proveedores WHERE nombre=?", [n]))
        dbRun("INSERT INTO proveedores (nombre,identificacion,telefono,email,direccion) VALUES (?,?,?,?,?)",[n,id,tel,em,dir]);
    });

    // ── Helpers para lookups ───────────────────────────────────────────────
    const gp   = cod => dbGet("SELECT id, precio_venta, nombre FROM productos WHERE codigo=?", [cod]);
    const gcli = nom => dbGet("SELECT id FROM clientes WHERE nombre=?", [nom])?.id || null;
    const gprov = nom => dbGet("SELECT id FROM proveedores WHERE nombre=?", [nom])?.id || null;

    // ── Ventas históricas (últimos 30 días) ────────────────────────────────
    // [numero, fecha, cliente, metodo, [ [codigo,qty], ... ] ]
    const ventas = [
      ['FAC-000001', dga(29,'08:15:00'), null,            'efectivo',      [['ALI001',2],['ALI002',1],['BEB001',3]]],
      ['FAC-000002', dga(28,'10:30:00'), 'María González','efectivo',      [['LAC001',2],['LAC002',1],['ALI005',2]]],
      ['FAC-000003', dga(27,'12:00:00'), 'Carlos Pérez',  'transferencia', [['BEB002',4],['SNK001',2],['SNK003',5]]],
      ['FAC-000004', dga(26,'09:45:00'), null,            'efectivo',      [['ALI003',3],['ALI004',1],['LIM001',2]]],
      ['FAC-000005', dga(25,'14:20:00'), 'Ana Martínez',  'transferencia', [['HIG001',1],['HIG002',3],['HIG003',1]]],
      ['FAC-000006', dga(23,'11:00:00'), 'Familia López', 'efectivo',      [['LAC001',4],['LAC003',1],['ALI001',3],['ALI005',2]]],
      ['FAC-000007', dga(21,'16:30:00'), null,            'efectivo',      [['BEB001',6],['BEB004',4],['SNK002',3]]],
      ['FAC-000008', dga(19,'09:00:00'), 'Pedro Sánchez', 'transferencia', [['ALI008',2],['ALI007',2],['ALI003',2]]],
      ['FAC-000009', dga(17,'13:15:00'), 'María González','efectivo',      [['LAC002',1],['LAC004',1],['LAC001',3]]],
      ['FAC-000010', dga(15,'15:00:00'), 'José Rodríguez','efectivo',      [['LIM002',1],['LIM003',1],['HIG002',4]]],
      ['FAC-000011', dga(13,'10:00:00'), null,            'efectivo',      [['ALI001',5],['ALI002',2],['ALI006',2],['BEB001',4]]],
      ['FAC-000012', dga(11,'17:30:00'), 'Carlos Pérez',  'transferencia', [['SNK001',3],['SNK002',4],['BEB002',6],['BEB004',2]]],
      ['FAC-000013', dga(9, '11:45:00'), 'Ana Martínez',  'efectivo',      [['HIG001',1],['HIG003',2],['LAC001',2],['LAC003',1]]],
      ['FAC-000014', dga(7, '09:30:00'), null,            'efectivo',      [['ALI004',2],['ALI005',3],['ALI002',2],['LIM001',3]]],
      ['FAC-000015', dga(5, '14:00:00'), 'Familia López', 'transferencia', [['LAC001',6],['LAC002',2],['ALI001',4],['BEB003',2]]],
      ['FAC-000016', dga(4, '10:30:00'), 'Pedro Sánchez', 'efectivo',      [['ALI008',3],['BEB001',5],['SNK003',8]]],
      ['FAC-000017', dga(3, '12:15:00'), 'María González','transferencia', [['HIG001',2],['HIG002',4],['HIG003',2],['LAC004',1]]],
      ['FAC-000018', dga(2, '15:45:00'), null,            'efectivo',      [['ALI001',3],['ALI003',2],['ALI007',2],['BEB004',3]]],
      ['FAC-000019', dga(1, '09:00:00'), 'Carlos Pérez',  'efectivo',      [['LAC001',2],['LAC002',1],['SNK001',2]]],
      ['FAC-000020', dga(0, '11:30:00'), 'Ana Martínez',  'transferencia', [['ALI004',1],['ALI005',2],['BEB003',1],['LIM002',1]]],
    ];

    for (const [numero, fecha, cliNom, metodo, items] of ventas) {
      if (dbGet("SELECT id FROM ventas WHERE numero=?", [numero])) continue;
      const cliId = cliNom ? gcli(cliNom) : null;
      let subtotal = 0;
      const det = items.map(([cod, qty]) => {
        const p = gp(cod); if (!p) return null;
        const tot = +(p.precio_venta * qty).toFixed(2); subtotal += tot;
        return { pid: p.id, nom: p.nombre, pv: p.precio_venta, qty, tot };
      }).filter(Boolean);
      subtotal = +subtotal.toFixed(2);
      dbRun(`INSERT OR IGNORE INTO ventas
             (numero,cliente_id,fecha,subtotal,descuento,impuesto,total,pagado,metodo_pago,estado,creado_en)
             VALUES (?,?,?,?,0,0,?,?,?,?,?)`,
        [numero, cliId, fecha, subtotal, subtotal, subtotal, metodo, 'completada', fecha]);
      const vid = dbGet('SELECT last_insert_rowid() as id').id;
      if (!vid) continue;
      for (const item of det) {
        dbRun(`INSERT INTO ventas_detalle (venta_id,producto_id,nombre,cantidad,precio,descuento,total)
               VALUES (?,?,?,?,?,0,?)`, [vid, item.pid, item.nom, item.qty, item.pv, item.tot]);
      }
    }

    // ── Compras históricas ─────────────────────────────────────────────────
    // [numero, fecha, proveedor, [ [codigo, qty, precio_compra], ... ] ]
    const compras = [
      ['COM-0001', dga(25,'08:00:00'), 'Distribuidora Polar',    [['ALI001',100,0.80],['ALI002',80,0.90],['ALI003',120,0.60],['ALI005',90,0.70]]],
      ['COM-0002', dga(20,'09:00:00'), 'Lácteos Los Andes',      [['LAC001',60,1.30],['LAC002',30,3.00],['LAC003',40,2.00],['LAC004',24,2.50]]],
      ['COM-0003', dga(15,'10:00:00'), 'Distribuidora Polar',    [['BEB001',150,0.40],['BEB002',100,0.60],['BEB003',48,1.20],['BEB004',80,0.80]]],
      ['COM-0004', dga(10,'09:00:00'), 'Importadora Todo Hogar', [['LIM001',60,0.60],['LIM002',50,1.20],['LIM003',40,0.90],['HIG001',36,2.00],['HIG002',72,0.60],['HIG003',40,1.50]]],
      ['COM-0005', dga(5, '11:00:00'), 'Distribuidora El Parque',[['ALI004',60,2.50],['ALI006',80,0.30],['ALI007',70,0.80],['ALI008',50,1.50],['SNK001',60,1.00],['SNK002',80,0.80],['SNK003',120,0.40]]],
    ];

    for (const [numero, fecha, provNom, items] of compras) {
      if (dbGet("SELECT id FROM compras WHERE numero=?", [numero])) continue;
      const provId = gprov(provNom);
      let subtotal = 0;
      const det = items.map(([cod, qty, pc]) => {
        const p = gp(cod); if (!p) return null;
        const tot = +(pc * qty).toFixed(2); subtotal += tot;
        return { pid: p.id, nom: p.nombre, qty, pc, tot };
      }).filter(Boolean);
      subtotal = +subtotal.toFixed(2);
      dbRun(`INSERT OR IGNORE INTO compras
             (numero,proveedor_id,fecha,subtotal,impuesto,total,pagado,estado,creado_en)
             VALUES (?,?,?,?,0,?,?,?,?)`,
        [numero, provId, fecha, subtotal, subtotal, subtotal, 'pagada', fecha]);
      const cid = dbGet('SELECT last_insert_rowid() as id').id;
      if (!cid) continue;
      for (const item of det) {
        dbRun(`INSERT INTO compras_detalle (compra_id,producto_id,nombre,cantidad,precio,total)
               VALUES (?,?,?,?,?,?)`, [cid, item.pid, item.nom, item.qty, item.pc, item.tot]);
      }
    }

    // ── Gastos del mes ─────────────────────────────────────────────────────
    [
      ['Alquiler del local',        'alquiler',      350.00, dga(28,'08:00:00')],
      ['Electricidad CORPOELEC',    'servicios',      85.00, dga(27,'09:00:00')],
      ['Internet CANTV',            'servicios',      45.00, dga(27,'10:00:00')],
      ['Bolsas y empaques',         'insumos',        28.50, dga(20,'10:00:00')],
      ['Mantenimiento equipo POS',  'mantenimiento',  40.00, dga(15,'11:00:00')],
      ['Publicidad redes sociales', 'publicidad',     30.00, dga(10,'09:00:00')],
      ['Alquiler del local',        'alquiler',      350.00, dga(0, '08:00:00')],
    ].forEach(([concepto,cat,monto,fecha]) =>
      dbRun("INSERT INTO gastos (concepto,categoria,monto,fecha) VALUES (?,?,?,?)",[concepto,cat,monto,fecha]));

    // Actualizar siguiente_numero para continuar después de las ventas demo
    dbRun("INSERT OR REPLACE INTO config (clave,valor) VALUES ('siguiente_numero','21')");
    // Marcar como sembrado
    dbRun("INSERT OR IGNORE INTO config (clave,valor) VALUES ('datos_demo_sembrados','1')");

    dbRun('COMMIT');
    save();
    console.log('[ContaFlex] ✅ Datos de demostración cargados correctamente.');
  } catch (e) {
    try { dbRun('ROLLBACK'); } catch(_) {}
    console.error('[ContaFlex] Error al sembrar datos demo:', e);
  }
}

function insertarUsuariosIniciales() {
  try {
    const hash = (p) => crypto
      .createHash('sha256')
      .update('contaflex2026::' + p)
      .digest('hex');

    // INSERT OR IGNORE: si ya existen no hace nada, si no existen los crea.
    // Esto también corre cuando la tabla recién fue creada en esta sesión.
    dbRun("INSERT OR IGNORE INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)",
      ['Administrador', 'admin', hash('admin123'), 'admin']);
    dbRun("INSERT OR IGNORE INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)",
      ['Mesero', 'mesero', hash('mesero123'), 'mesero']);
    dbRun("INSERT OR IGNORE INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)",
      ['Cliente Demo', 'cliente', hash('cliente123'), 'cliente']);
    save();
  } catch (e) {
    console.error('[ContaFlex] Error al crear usuarios iniciales:', e);
  }
}

module.exports = { init, getInstance };
