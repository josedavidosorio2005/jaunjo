# ContaFlex 🧾

**Software de contabilidad multiplataforma para pequeños negocios**

---

## Características

| Módulo | Funcionalidades |
|--------|----------------|
| 🧾 **Ventas (POS)** | Punto de venta con catálogo, carrito, impuesto automático, descuentos, ventas a crédito, historial, anular venta, **imprimir recibo** |
| 📦 **Inventario** | CRUD productos con código/precio/stock, categorías con colores, alertas de stock bajo, búsqueda en tiempo real |
| 👥 **Clientes** | CRUD clientes, historial de compras, saldo de deuda, registro de pagos parciales |
| 🛒 **Compras** | Registro de compras con detalle, actualiza stock automáticamente, CRUD proveedores, **registro de gastos por categoría** |
| 📊 **Reportes** | Balance general, ventas por día (gráfico), productos más vendidos, clientes top, flujo de efectivo |
| ⚙ **Configuración** | Nombre y datos del negocio, moneda y símbolo, % IVA, prefijo y numeración de facturas, color primario, módulos activos |

---

## Cómo lanzar

**Doble clic en `ContaFlex.bat`**

O desde PowerShell:
```powershell
cd "ruta\al\proyecto"
node_modules\electron\dist\electron.exe .
```

---

## Tecnologías

- **Electron v28** — app de escritorio multiplataforma
- **sql.js v1.12.0** — SQLite en WebAssembly (sin compilación nativa necesaria)
- **Vanilla JS / HTML / CSS** — sin frameworks externos
- **Node.js v22** — runtime

---

## Datos de prueba

Al abrir la app por primera vez se crean automáticamente:
- 5 categorías de ejemplo
- 3 productos de ejemplo
- 1 cliente genérico
- Configuración inicial (moneda USD, IVA 16%)

---

## Estructura del proyecto

```
ContaFlex/
├── src/
│   ├── main/         # Proceso principal de Electron
│   ├── database/     # Capa SQLite con sql.js
│   ├── ipc/          # Handlers de comunicación main↔renderer
│   └── renderer/     # Interfaz (HTML, CSS, JS)
│       └── pages/    # Módulos de cada sección
├── assets/
├── ContaFlex.bat     # Lanzador Windows
└── package.json
```

---

## Base de datos

La base de datos se guarda en:
`%APPDATA%\contaflex\contaflex.db`

 — Software de Contabilidad

Software de contabilidad multiplataforma para pequeños negocios, desarrollado con **Electron + sql.js**.

## Características

- Dashboard con KPIs en tiempo real
- Punto de Venta (POS) con carrito interactivo
- Inventario con control de stock y alertas
- Gestión de Clientes y deudas
- Compras y Proveedores
- Reportes financieros con gráficos
- Configuración personalizable (nombre, moneda, impuesto, colores, módulos)

## Estructura del Proyecto

```
ContaFlex/
├── src/
│   ├── main/
│   │   ├── main.js          # Proceso principal Electron
│   │   └── preload.js       # Bridge seguro IPC
│   ├── database/
│   │   └── db.js            # SQL.js - Base de datos SQLite (sin compilación nativa)
│   ├── ipc/
│   │   ├── ventas.js
│   │   ├── inventario.js
│   │   ├── clientes.js
│   │   ├── compras.js
│   │   ├── reportes.js
│   │   └── config.js
│   └── renderer/
│       ├── index.html       # Shell principal SPA
│       ├── css/main.css     # Design system
│       ├── js/app.js        # Controlador de navegación
│       └── pages/           # Módulos de cada sección
├── ContaFlex.bat            # Inicio rápido en Windows
└── package.json
```

## Iniciar la Aplicación

### Opción 1 — Doble clic
Ejecuta **`ContaFlex.bat`**

### Opción 2 — Terminal
```bash
cd ContaFlex
npm run launch
```

### Opción 3 — PowerShell
```powershell
cd "ContaFlex"
& "node_modules\electron\dist\electron.exe" .
```

## Instalar dependencias (primera vez)

```bash
npm install --ignore-scripts
```

## Base de Datos

Los datos se guardan automáticamente en:
```
%APPDATA%\contaflex\contaflex.db
```

## Módulos del MVP

| Módulo       | Función                                      |
|-------------|----------------------------------------------|
| Dashboard   | Resumen del día, balance del mes, alertas     |
| Ventas      | POS, carrito, historial, anulaciones          |
| Inventario  | Productos, categorías, stock mínimo           |
| Clientes    | Registro, deudas, historial, pagos            |
| Compras     | Proveedores, registro de compras              |
| Reportes    | Balance, ventas por día, top productos        |
| Configuración | Nombre, moneda, impuesto, colores, módulos  |
