const crypto = require('crypto');

/**
 * Hashea una contraseña con SHA-256 + sal fija de la aplicación.
 * Para una app de escritorio local, esto es suficientemente seguro.
 */
function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update('contaflex2026::' + password)
    .digest('hex');
}

function register(ipcMain, db) {
  const d = db.getInstance();

  // Iniciar sesión
  ipcMain.handle('usuarios:login', (_, { usuario, password }) => {
    if (!usuario || !password) return null;
    const hash = hashPassword(password);
    const user = d.get(
      'SELECT id, nombre, usuario, rol FROM usuarios WHERE usuario=? AND password_hash=? AND activo=1',
      usuario, hash
    );
    return user || null;
  });

  // Obtener todos los usuarios
  ipcMain.handle('usuarios:obtenerTodos', () => {
    return d.all(
      'SELECT id, nombre, usuario, rol, activo, creado_en FROM usuarios ORDER BY nombre'
    );
  });

  // Crear usuario
  ipcMain.handle('usuarios:crear', (_, u) => {
    if (!u.nombre || !u.usuario || !u.password) throw new Error('Campos incompletos');
    if (u.password.length < 4) throw new Error('Contraseña mínimo 4 caracteres');
    const hash = hashPassword(u.password);
    d.run(
      'INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)',
      u.nombre, u.usuario.toLowerCase(), hash, u.rol || 'mesero'
    );
    return { id: d.lastInsertRowid() };
  });

  // Actualizar usuario
  ipcMain.handle('usuarios:actualizar', (_, u) => {
    if (!u.id || !u.nombre || !u.usuario) throw new Error('Campos incompletos');
    if (u.password && u.password.trim()) {
      if (u.password.length < 4) throw new Error('Contraseña mínimo 4 caracteres');
      const hash = hashPassword(u.password);
      d.run(
        'UPDATE usuarios SET nombre=?, usuario=?, password_hash=?, rol=?, activo=? WHERE id=?',
        u.nombre, u.usuario.toLowerCase(), hash, u.rol, u.activo ?? 1, u.id
      );
    } else {
      d.run(
        'UPDATE usuarios SET nombre=?, usuario=?, rol=?, activo=? WHERE id=?',
        u.nombre, u.usuario.toLowerCase(), u.rol, u.activo ?? 1, u.id
      );
    }
    return { ok: true };
  });

  // Eliminar usuario
  ipcMain.handle('usuarios:eliminar', (_, id) => {
    d.run('DELETE FROM usuarios WHERE id=?', id);
    return { ok: true };
  });

  // Recuperación de emergencia: reinicia la contraseña del admin a admin123
  ipcMain.handle('usuarios:resetAdmin', () => {
    const hash = hashPassword('admin123');
    // Si existe el usuario admin, resetea su clave. Si no existe, lo crea.
    const existe = d.get("SELECT id FROM usuarios WHERE usuario='admin'");
    if (existe) {
      d.run("UPDATE usuarios SET password_hash=?, activo=1 WHERE usuario='admin'", hash);
    } else {
      d.run('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)',
        'Administrador', 'admin', hash, 'admin');
    }
    return { ok: true };
  });

  // Diagnóstico: verifica cuántos usuarios existen (sin exponer datos sensibles)
  ipcMain.handle('usuarios:diagnostico', () => {
    try {
      const cuenta = d.get('SELECT COUNT(*) AS total FROM usuarios');
      const admin  = d.get("SELECT id, nombre, activo FROM usuarios WHERE usuario='admin'");
      return { total: cuenta?.total ?? 0, adminExiste: !!admin, adminActivo: admin?.activo === 1 };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register, hashPassword };
