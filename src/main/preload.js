const { contextBridge, ipcRenderer } = require('electron');

// Expose una API segura al renderer process
contextBridge.exposeInMainWorld('api', {
  // Ventas
  ventas: {
    crear: (venta) => ipcRenderer.invoke('ventas:crear', venta),
    obtenerTodas: (filtros) => ipcRenderer.invoke('ventas:obtenerTodas', filtros),
    obtenerPorId: (id) => ipcRenderer.invoke('ventas:obtenerPorId', id),
    obtenerResumenHoy: () => ipcRenderer.invoke('ventas:resumenHoy'),
    anular: (id) => ipcRenderer.invoke('ventas:anular', id),
  },
  // Inventario
  inventario: {
    obtenerProductos: (filtros) => ipcRenderer.invoke('inventario:obtenerProductos', filtros),
    crearProducto: (prod) => ipcRenderer.invoke('inventario:crearProducto', prod),
    actualizarProducto: (prod) => ipcRenderer.invoke('inventario:actualizarProducto', prod),
    eliminarProducto: (id) => ipcRenderer.invoke('inventario:eliminarProducto', id),
    obtenerCategorias: () => ipcRenderer.invoke('inventario:obtenerCategorias'),
    crearCategoria: (cat) => ipcRenderer.invoke('inventario:crearCategoria', cat),
    buscarPorCodigo: (codigo) => ipcRenderer.invoke('inventario:buscarPorCodigo', codigo),
    stockBajo: () => ipcRenderer.invoke('inventario:stockBajo'),
  },
  // Clientes
  clientes: {
    obtenerTodos: (filtros) => ipcRenderer.invoke('clientes:obtenerTodos', filtros),
    crearCliente: (c) => ipcRenderer.invoke('clientes:crearCliente', c),
    actualizarCliente: (c) => ipcRenderer.invoke('clientes:actualizarCliente', c),
    eliminarCliente: (id) => ipcRenderer.invoke('clientes:eliminarCliente', id),
    obtenerHistorial: (id) => ipcRenderer.invoke('clientes:obtenerHistorial', id),
    registrarPago: (pago) => ipcRenderer.invoke('clientes:registrarPago', pago),
  },
  // Compras / Proveedores
  compras: {
    obtenerProveedores: () => ipcRenderer.invoke('compras:obtenerProveedores'),
    crearProveedor: (p) => ipcRenderer.invoke('compras:crearProveedor', p),
    actualizarProveedor: (p) => ipcRenderer.invoke('compras:actualizarProveedor', p),
    registrarCompra: (c) => ipcRenderer.invoke('compras:registrarCompra', c),
    obtenerCompras: (filtros) => ipcRenderer.invoke('compras:obtenerCompras', filtros),
    obtenerGastos: () => ipcRenderer.invoke('compras:obtenerGastos'),
    registrarGasto: (g) => ipcRenderer.invoke('compras:registrarGasto', g),
  },
  // Reportes
  reportes: {
    ventasPorPeriodo: (filtros) => ipcRenderer.invoke('reportes:ventasPorPeriodo', filtros),
    balanceGeneral: (filtros) => ipcRenderer.invoke('reportes:balanceGeneral', filtros),
    productosMasVendidos: (filtros) => ipcRenderer.invoke('reportes:productosMasVendidos', filtros),
    clientesTop: () => ipcRenderer.invoke('reportes:clientesTop'),
    flujoEfectivo: (filtros) => ipcRenderer.invoke('reportes:flujoEfectivo', filtros),
    estadoResultados: (filtros) => ipcRenderer.invoke('reportes:estadoResultados', filtros),
    gananciasPorProducto: (filtros) => ipcRenderer.invoke('reportes:gananciasPorProducto', filtros),
    libroContable: (filtros) => ipcRenderer.invoke('reportes:libroContable', filtros),
  },
  // Configuración
  config: {
    obtener: () => ipcRenderer.invoke('config:obtener'),
    guardar: (cfg) => ipcRenderer.invoke('config:guardar', cfg),
    resetear: () => ipcRenderer.invoke('config:resetear'),
  },
  // Autenticación y usuarios
  auth: {
    login:         (creds) => ipcRenderer.invoke('usuarios:login',         creds),
    obtenerTodos:  ()      => ipcRenderer.invoke('usuarios:obtenerTodos'),
    crear:         (u)     => ipcRenderer.invoke('usuarios:crear',         u),
    actualizar:    (u)     => ipcRenderer.invoke('usuarios:actualizar',    u),
    eliminar:      (id)    => ipcRenderer.invoke('usuarios:eliminar',      id),
    resetAdmin:    ()      => ipcRenderer.invoke('usuarios:resetAdmin'),
    diagnostico:   ()      => ipcRenderer.invoke('usuarios:diagnostico'),
  },
  // Arqueo de caja
  arqueo: {
    abrirTurno:  (datos)  => ipcRenderer.invoke('arqueo:abrirTurno',  datos),
    cerrarTurno: (datos)  => ipcRenderer.invoke('arqueo:cerrarTurno', datos),
    turnoActivo: ()       => ipcRenderer.invoke('arqueo:turnoActivo'),
    historial:   (filtros)=> ipcRenderer.invoke('arqueo:historial',   filtros),
    obtenerPorId:(id)     => ipcRenderer.invoke('arqueo:obtenerPorId',id),
  },
  // Impresión de tickets
  ticket: {
    imprimir: (html) => ipcRenderer.invoke('ticket:imprimir', html),
    preview:  (html) => ipcRenderer.invoke('ticket:preview',  html),
  },
  // Diálogos y ventana
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  // Servidor web / multijugador
  servidor: {
    status:         ()        => ipcRenderer.invoke('server:status'),
    start:          (port)    => ipcRenderer.invoke('server:start', port),
    stop:           ()        => ipcRenderer.invoke('server:stop'),
    generarQR:      (url)     => ipcRenderer.invoke('server:qr', url),
    abrirNavegador: (url)     => ipcRenderer.invoke('server:openBrowser', url),
    abrirFirewall:  (port)    => ipcRenderer.invoke('server:openFirewall', port),
    crearHotspot:   (opts)    => ipcRenderer.invoke('server:crearHotspot', opts),
  },
});
