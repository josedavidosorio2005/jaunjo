/* =============================================
   ContaFlex — App Controller
   ============================================= */

// Estado global
window.appState = {
  config: {},
  paginaActual: 'dashboard'
};

// Caché de páginas HTML: evita fetch repetido al navegar
const _paginaCache = {};
// Caché de snapshots renderizados — guarda el DOM con datos ya cargados
// para que la segunda visita sea completamente instantánea (sin spinners).
// No expira por tiempo: solo se invalida cuando hay escrituras en la BD.
const _pageSnapshot = {};

// Prefetch: carga la página en segundo plano sin renderizarla
async function prefetchPagina(nombre) {
  if (_paginaCache[nombre] || !paginas[nombre]) return;
  try {
    const r = await fetch(paginas[nombre]);
    if (r.ok) _paginaCache[nombre] = await r.text();
  } catch (_) { /* silencioso */ }
}

// ── Caché transparente de respuestas IPC ────────────────────────────────────
// Envuelve window.api para que las lecturas frecuentes se sirvan desde memoria
// y no vayan al proceso principal en cada visita a la misma página.
(function _wrapApiConCache() {
  if (!window.api || window.api.__cached) return;
  try {
    const _c = new Map();
    const TTL = 25000; // 25 s — datos frescos pero sin re-query innecesario
    // Métodos cuyo resultado se puede cachear (solo lectura)
    const READ_RX = /listar|obtenerTodos|obtenerTodas|obtenerResumen|stockBajo|balanceGeneral|ventasPorPeriodo|productosMasVendidos|clientesTop|flujoEfectivo|estadoResultados|gananciasPorProducto|libroContable|categorias|proveedores/;
    // Al escribir en un namespace, se invalidan los namespaces relacionados
    const INVALIDAR = {
      ventas:    ['ventas','reportes'],
      inventario:['inventario','reportes'],
      clientes:  ['clientes'],
      compras:   ['compras','reportes','inventario'],
      config:    ['config'],
    };
    // Páginas cuyo snapshot se debe borrar cuando se escribe en un namespace
    const SNAP_INV = {
      ventas:    ['ventas','dashboard','reportes'],
      inventario:['inventario','dashboard','reportes'],
      clientes:  ['clientes','dashboard'],
      compras:   ['compras','dashboard','reportes','inventario'],
      config:    ['configuracion'],
    };
    // Guardar referencias originales antes de envolver
    const origs = {};
    for (const [ns, obj] of Object.entries(window.api)) {
      if (!obj || typeof obj !== 'object') { origs[ns] = obj; continue; }
      origs[ns] = {};
      for (const [m, f] of Object.entries(obj)) origs[ns][m] = f;
    }
    // Construir objeto envuelto
    const wrapped = { __cached: true };
    for (const [ns, obj] of Object.entries(origs)) {
      if (!obj || typeof obj !== 'object') { wrapped[ns] = obj; continue; }
      wrapped[ns] = {};
      for (const [m, f] of Object.entries(obj)) {
        if (typeof f !== 'function') { wrapped[ns][m] = f; continue; }
        if (READ_RX.test(m)) {
          // Lectura: devolver caché si es reciente
          wrapped[ns][m] = async (...a) => {
            const k = `${ns}:${m}:${JSON.stringify(a)}`;
            const h = _c.get(k);
            if (h && Date.now() - h.t < TTL) return h.d;
            const d = await f(...a);
            _c.set(k, { d, t: Date.now() });
            return d;
          };
        } else {
          // Escritura: ejecutar y limpiar cachés IPC + snapshots relacionados
          wrapped[ns][m] = async (...a) => {
            const r = await f(...a);
            const inv = INVALIDAR[ns] || [ns];
            for (const pref of inv)
              for (const k of _c.keys())
                if (k.startsWith(pref + ':')) _c.delete(k);
            // Invalidar snapshots de páginas afectadas para que muestren datos frescos
            const sinv = SNAP_INV[ns] || [ns];
            for (const p of sinv) delete _pageSnapshot[p];
            return r;
          };
        }
      }
    }
    window.api = wrapped;
    window._ipcCache = _c; // accesible para diagnóstico desde DevTools
  } catch (e) {
    console.warn('[ContaFlex] Caché IPC no aplicado:', e.message);
  }
})();

// Pre-calentar caché con los datos más usados justo después del login
async function preCargaDatos() {
  if (!window.api) return;
  Promise.allSettled([
    api.ventas.obtenerResumenHoy(),
    api.inventario.stockBajo(),
    api.clientes.obtenerTodos({}),
    api.ventas.obtenerTodas({}),
    api.inventario.listarProductos({}),
  ]).catch(() => {});
}

// Sesión activa
window.sesion = null;

// Permisos por rol
const permisos = {
  admin:      ['dashboard','ventas','inventario','clientes','compras','reportes','configuracion','usuarios','pedido','arqueo'],
  vendedor:   ['dashboard','ventas','inventario','pedido','arqueo'],
  cajero:     ['dashboard','ventas','inventario','pedido','arqueo'],
  supervisor: ['dashboard','ventas','inventario','clientes','compras','reportes','pedido','arqueo'],
  mesero:     ['dashboard','ventas','inventario','pedido','arqueo'],
  cliente:    ['pedido']
};

// Mapa de páginas — rutas relativas desde index.html
const paginas = {
  dashboard:    'pages/dashboard.html',
  ventas:       'pages/ventas.html',
  inventario:   'pages/inventario.html',
  clientes:     'pages/clientes.html',
  compras:      'pages/compras.html',
  reportes:     'pages/reportes.html',
  configuracion:'pages/configuracion.html',
  pedido:       'pages/pedido.html',
  usuarios:     'pages/usuarios.html',
  arqueo:       'pages/arqueo.html'
};

// ---- Inicialización ----
document.addEventListener('DOMContentLoaded', async () => {
  await cargarConfig();
  aplicarTema();

  // Prefetch de TODAS las páginas en segundo plano (HTML queda en memoria)
  setTimeout(() => {
    Object.keys(paginas).forEach(p => prefetchPagina(p));
  }, 800);

  // Nombre en pantalla de login
  const nm = appState.config.nombre_negocio || 'ContaFlex';
  const loginTitle = document.getElementById('loginAppName');
  if (loginTitle) loginTitle.textContent = nm;

  // Foco automático en el campo usuario
  setTimeout(() => document.getElementById('loginUser')?.focus(), 80);

  // Atajos de teclado en login
  document.getElementById('loginPass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') hacerLogin();
  });
  document.getElementById('loginUser')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginPass')?.focus();
  });
});

// Toggle mostrar/ocultar contraseña
function toggleVerClave() {
  const inp = document.getElementById('loginPass');
  const btn = document.getElementById('passToggle');
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
    btn.title = 'Ocultar contraseña';
  } else {
    inp.type = 'password';
    btn.textContent = '👁️';
    btn.title = 'Mostrar contraseña';
  }
}

// Rellenar usuario/clave al hacer click en un rol
function seleccionarRol(usuario, clave) {
  const u = document.getElementById('loginUser');
  const p = document.getElementById('loginPass');
  if (u) { u.value = usuario; }
  if (p) { p.value = clave; }
  // Resaltar la card seleccionada
  document.querySelectorAll('.login-role-item').forEach(el => el.classList.remove('selected'));
  const items = document.querySelectorAll('.login-role-item');
  const idx   = ['admin','mesero','cliente'].indexOf(usuario);
  if (items[idx]) items[idx].classList.add('selected');
  // Pequeña animación de confirmación
  const card = document.getElementById('loginCard');
  card?.classList.add('pulse');
  setTimeout(() => card?.classList.remove('pulse'), 400);
}

// ---- Autenticación ----
async function hacerLogin() {
  const usuario  = document.getElementById('loginUser')?.value.trim();
  const password = document.getElementById('loginPass')?.value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');
  const btnText  = document.getElementById('loginBtnText');
  const card     = document.getElementById('loginCard');

  if (!usuario || !password) {
    if (errEl) { errEl.textContent = 'Completa usuario y contraseña'; errEl.classList.remove('hidden'); }
    sacudirCard(card);
    return;
  }

  if (btn)    { btn.disabled = true; }
  if (btnText){ btnText.innerHTML = '<span class="login-spinner"></span> Verificando...'; }
  if (errEl)  errEl.classList.add('hidden');

  try {
    const user = await api.auth.login({ usuario, password });
    if (!user) {
      if (errEl) { errEl.textContent = '❌ Usuario o contraseña incorrectos'; errEl.classList.remove('hidden'); }
      if (btn)   btn.disabled = false;
      if (btnText) btnText.textContent = 'Iniciar Sesión';
      sacudirCard(card);
      document.getElementById('loginPass').value = '';
      document.getElementById('loginPass').focus();
      return;
    }
    const passInp = document.getElementById('loginPass');
    if (passInp) passInp.type = 'password';
    const passBtn = document.getElementById('passToggle');
    if (passBtn)  passBtn.textContent = '👁️';

    window.sesion = user;
    document.body.classList.add(`rol-${user.rol}`);
    aplicarSidebar();

    card?.classList.add('login-exit');
    setTimeout(async () => {
      document.getElementById('loginOverlay').classList.add('hidden');
      card?.classList.remove('login-exit');
      // Marcar el rol-item como no seleccionado para la próxima vez
      document.querySelectorAll('.login-role-item').forEach(el => el.classList.remove('selected'));
      await navegarA(user.rol === 'cliente' ? 'pedido' : 'dashboard');
      // Pre-calentar caché de datos tras el primer render
      if (user.rol !== 'cliente') setTimeout(preCargaDatos, 400);
      // Activar botón flotante del servidor web (solo admin/mesero)
      if (user.rol === 'admin' || user.rol === 'mesero') {
        if (typeof window._initServidorFAB === 'function') window._initServidorFAB();
      }
    }, 250);

  } catch (e) {
    console.error('Login error:', e);
    // Mostrar el mensaje real del error para facilitar diagnóstico
    const msg = e?.message || String(e) || 'Error desconocido';
    if (errEl)   { errEl.innerHTML = `⚠ Error técnico: <em>${msg}</em><br><small>Intenta <a href="#" onclick="recuperarAdmin()" style="color:var(--primary-light);text-decoration:underline">restablecer admin</a></small>`; errEl.classList.remove('hidden'); }
    if (btn)     btn.disabled = false;
    if (btnText) btnText.textContent = 'Iniciar Sesión';
    sacudirCard(card);
  }
}

function sacudirCard(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // reflow para reiniciar la animación
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

// Recuperación de emergencia: reinicia el admin a admin/admin123
async function recuperarAdmin() {
  const errEl  = document.getElementById('loginError');
  const btnText = document.getElementById('loginBtnText');
  try {
    // Diagnóstico primero
    const diag = await api.auth.diagnostico();
    console.log('[Auth] Diagnóstico DB:', diag);

    await api.auth.resetAdmin();

    // Rellenar credenciales automáticamente
    document.getElementById('loginUser').value = 'admin';
    document.getElementById('loginPass').value = 'admin123';
    seleccionarRol('admin', 'admin123');

    if (errEl) {
      errEl.innerHTML = '✔ Admin restablecido. Usuario: <strong>admin</strong> · Contraseña: <strong>admin123</strong>';
      errEl.style.color = 'var(--success)';
      errEl.style.borderColor = 'rgba(34,197,94,0.4)';
      errEl.style.background  = 'rgba(34,197,94,0.08)';
      errEl.classList.remove('hidden');
    }
  } catch (e) {
    console.error('Reset admin error:', e);
    if (errEl) {
      errEl.textContent = '❌ No se pudo restablecer: ' + (e.message || e);
      errEl.style.color = '';
      errEl.style.borderColor = '';
      errEl.style.background  = '';
      errEl.classList.remove('hidden');
    }
  }
}

function cerrarSesion() {
  window.sesion = null;
  document.body.classList.remove('rol-admin','rol-mesero','rol-cliente');

  // Restablecer sidebar
  document.getElementById('sesionNombre').textContent = '-';
  document.getElementById('sesionRol').textContent    = '-';
  document.getElementById('sidebar').style.display    = '';
  document.querySelectorAll('.nav-item[data-page]').forEach(el => el.classList.add('hidden'));

  // Limpiar contenido y snapshots al cerrar sesión
  document.getElementById('mainContent').innerHTML = '';
  Object.keys(_pageSnapshot).forEach(k => delete _pageSnapshot[k]);

  // Mostrar login limpio
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    const u = document.getElementById('loginUser');
    const p = document.getElementById('loginPass');
    const e = document.getElementById('loginError');
    const b = document.getElementById('loginBtn');
    const t = document.getElementById('loginBtnText');
    if (u) { u.value = ''; }
    if (p) { p.value = ''; p.type = 'password'; }
    const pt = document.getElementById('passToggle');
    if (pt) pt.textContent = '👁️';
    if (e) e.classList.add('hidden');
    if (b) b.disabled = false;
    if (t) t.textContent = 'Iniciar Sesión';
    document.querySelectorAll('.login-role-item').forEach(el => el.classList.remove('selected'));
    setTimeout(() => u?.focus(), 80);
  }
}

function aplicarSidebar() {
  const rol = window.sesion?.rol;
  if (!rol) return;

  document.getElementById('sesionNombre').textContent = window.sesion.nombre;
  document.getElementById('sesionRol').textContent    = rol;

  if (rol === 'cliente') {
    document.getElementById('sidebar').style.display = 'none';
    return;
  }

  document.getElementById('sidebar').style.display = '';

  // Mostrar solo los items de navegación permitidos
  const permitidas = permisos[rol] || [];
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    const page = el.dataset.page;
    el.classList.toggle('hidden', !permitidas.includes(page));
  });
}

async function cargarConfig() {
  try {
    appState.config = await api.config.obtener();
    _paginaCache['_configTs'] = Date.now(); // marca de tiempo para invalidar
    // Aplicar nombre del negocio
    const nm = appState.config.nombre_negocio || 'ContaFlex';
    document.getElementById('appTitle').textContent = nm;
    document.getElementById('sidebarNombre').textContent = nm;
    document.title = nm;
    // Aplicar color primario
    if (appState.config.color_primario) {
      document.documentElement.style.setProperty('--primary', appState.config.color_primario);
    }
  } catch (e) {
    console.error('Error cargando config:', e);
  }
}

function aplicarTema() {
  // Solo dark theme por ahora; futuro: soporte light
}

// ---- Navegación SPA ----
async function navegarA(pagina) {
  if (!paginas[pagina]) return;

  // Verificar permisos
  if (window.sesion) {
    const permitidas = permisos[window.sesion.rol] || [];
    if (!permitidas.includes(pagina)) {
      toast('Sin permiso para acceder a esta sección', 'warning');
      return;
    }
  }

  // Desconectar observer de modo lectura anterior
  if (window._readOnlyObserver) {
    window._readOnlyObserver.disconnect();
    window._readOnlyObserver = null;
  }

  appState.paginaActual = pagina;

  // Actualizar sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pagina);
  });

  const main = document.getElementById('mainContent');

  // Limpiar scripts de la página anterior para evitar conflictos
  document.querySelectorAll('script[data-page-script]').forEach(s => s.remove());

  try {
    const _snap = _pageSnapshot[pagina];

    if (_snap) {
      // ── RAMA RÁPIDA: snapshot con datos reales → render INSTANTÁNEO ──────
      // Los spinners del template NO aparecen: el snapshot ya tiene la tabla llena.
      // El script re-corre igual para actualizar datos desde caché + re-enganchar eventos.
      main.innerHTML = _snap.html;
    } else {
      // ── RAMA NORMAL: primera visita → spinner → carga HTML → render ───────
      if (!_paginaCache[pagina]) {
        main.innerHTML = '<div class="page-transition-out"><div class="spinner"></div></div>';
      }
      let html = _paginaCache[pagina];
      if (!html) {
        const resp = await fetch(paginas[pagina]);
        if (!resp.ok) throw new Error(`No se pudo cargar ${paginas[pagina]} (${resp.status})`);
        html = await resp.text();
        _paginaCache[pagina] = html;
      }
      main.innerHTML = html;
    }

    // Animación de entrada
    main.classList.remove('page-fade-in');
    void main.offsetHeight;
    main.classList.add('page-fade-in');

    // Ejecutar script de la página: refresca datos desde caché y re-adjunta listeners
    const scriptEl = main.querySelector('script[data-page-init]');
    if (scriptEl) {
      const newScript = document.createElement('script');
      newScript.setAttribute('data-page-script', pagina);
      newScript.textContent = scriptEl.textContent;
      document.body.appendChild(newScript);
    }

    // Aplicar restricciones para mesero en inventario (solo lectura)
    if (window.sesion?.rol === 'mesero' && pagina === 'inventario') {
      setTimeout(aplicarModoSoloLectura, _snap ? 50 : 200);
    }

    // Guardar snapshot después de que el script haya pintado los datos
    // Sin TTL de tiempo: solo las escrituras invalidan el snapshot
    // Ventas: solo guardar si el POS no está activo (evitar guardar estado de venta)
    setTimeout(() => {
      if (appState.paginaActual !== pagina) return;
      if (pagina === 'ventas') {
        const posView = document.getElementById('vistaPos');
        if (posView && !posView.classList.contains('hidden')) return;
      }
      const snapHtml = document.getElementById('mainContent')?.innerHTML;
      if (snapHtml && snapHtml.length > 300) {
        _pageSnapshot[pagina] = { html: snapHtml, t: Date.now() };
      }
    }, 600);

  } catch (e) {
    console.error('Error navegando a', pagina, e);
    main.innerHTML = `<div class="empty-state">
      <div class="es-icon">⚠</div>
      <h3>Error cargando módulo</h3>
      <p>${e.message}</p>
    </div>`;
  }
}

// Quita botones de edición/borrado del inventario para el rol mesero
function aplicarModoSoloLectura() {
  // Quitar botones del encabezado
  const headerAcc = document.querySelector('.page-header .flex.gap-2');
  if (headerAcc) headerAcc.remove();

  // Badge informativo
  const titulo = document.querySelector('.page-header h1');
  if (titulo) {
    titulo.insertAdjacentHTML('afterend',
      '<span class="badge badge-purple" style="font-size:11px;margin-left:8px;vertical-align:middle">Solo lectura</span>');
  }

  // Limpiar botones de filas ya cargadas
  const stripBtns = () => {
    document.querySelectorAll('#tablaProductos tr td:last-child .flex').forEach(el => {
      el.innerHTML = '─';
    });
  };
  stripBtns();

  // Observer para filas futuras (cuando se filtra o busca)
  const tbody = document.getElementById('tablaProductos');
  if (tbody) {
    const obs = new MutationObserver(stripBtns);
    obs.observe(tbody, { childList: true });
    window._readOnlyObserver = obs;
  }
}

// ---- Modal ----
function abrirModal(titulo, contenido, opciones = {}) {
  document.getElementById('modalTitle').textContent = titulo;
  document.getElementById('modalBody').innerHTML = contenido;
  document.getElementById('modalFooter').innerHTML = opciones.footer || '';
  const box = document.getElementById('modalBox');
  box.className = 'modal' + (opciones.size ? ` modal-${opciones.size}` : '');
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function cerrarModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modalBody').innerHTML = '';
  document.getElementById('modalFooter').innerHTML = '';
}

// Cerrar modal con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cerrarModal();
});
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) cerrarModal();
});

// ---- Toasts ----
function toast(msg, tipo = 'info', duracion = 3500) {
  const iconos = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<span>${iconos[tipo] || 'ℹ'}</span><span>${msg}</span>`;
  document.getElementById('toastsContainer').appendChild(el);
  setTimeout(() => el.remove(), duracion);
}

// ---- Helpers globales ----
function formatMoney(val) {
  const sym = appState.config.simbolo_moneda || '$';
  return `${sym}${Number(val || 0).toFixed(2)}`;
}

function formatDate(str) {
  if (!str) return '-';
  const d = new Date(str.replace(' ', 'T'));
  return d.toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
}

function formatDateTime(str) {
  if (!str) return '-';
  const d = new Date(str.replace(' ', 'T'));
  return d.toLocaleString('es', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function debounce(fn, delay = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function confirm(msg) {
  return new Promise(resolve => {
    abrirModal('Confirmar', `<p style="font-size:15px;color:var(--text-secondary)">${msg}</p>`, {
      footer: `
        <button class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-danger" id="confirmYes">Confirmar</button>
      `
    });
    document.getElementById('confirmYes').onclick = () => { cerrarModal(); resolve(true); };
  });
}

// Recargar configuración desde cualquier página
async function recargarConfig() {
  await cargarConfig();
  // Invalidar solo las páginas que dependen de config (configuracion)
  delete _paginaCache['configuracion'];
}
