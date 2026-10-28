// Comunicación con la hoja de Google del proyecto (Apps Script publicado como app web).
// Todas las consultas van por POST con la sesión en el cuerpo, nunca en la dirección.
// Un proyecto "de archivo" (.json) no tiene servidor: todo queda en el teléfono.

export class ErrorServidor extends Error {
  constructor(mensaje, codigo) { super(mensaje); this.codigo = codigo || ''; }
}

export function api(proy, sesion = null) {
  // text/plain evita la consulta previa CORS, que Apps Script no responde
  const llamar = async (a, datos = {}) => {
    const r = await fetch(proy.url, { method: 'POST', body: JSON.stringify({ a, s: sesion?.token, ...datos }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new ErrorServidor(j.error, j.codigo);
    return j;
  };
  return {
    remoto: !!proy.url,
    llamar,
    info: () => llamar('info'),
    yo: () => llamar('yo'),
    version: () => llamar('version'),
    proyecto: () => llamar('proyecto'),
    observaciones: () => llamar('obs'),
    enviar: (accion, datos) => llamar(accion, datos),
  };
}

// Enlace del proyecto: ...#p=<base64 de {n, u}>. Ya no lleva clave: el acceso es por inicio de sesión.
export function leerEnlace(texto) {
  const m = String(texto).match(/#p=([A-Za-z0-9_\-+/=%]+)/);
  if (!m) return null;
  try {
    const b = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
    const j = JSON.parse(decodeURIComponent(escape(atob(b))));
    if (!j.u) return null;
    return { nombre: j.n || 'Proyecto', url: j.u };
  } catch { return null; }
}

// ---- inicio de sesión con Google por redirección (funciona en iPhone, Android y PC) ----
export const URL_REGRESO = () => new URL('./', location.href).href;

export function irAGoogle(clientId, nonce, estado) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: URL_REGRESO(), response_type: 'id_token',
    scope: 'openid email profile', nonce, state: estado, prompt: 'select_account',
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

// Al volver de Google la dirección trae #id_token=...&state=...
export function leerRegreso(hash) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  if (p.get('id_token')) return { idToken: p.get('id_token'), estado: p.get('state') || '' };
  if (p.get('error')) return { error: p.get('error'), estado: p.get('state') || '' };
  return null;
}
