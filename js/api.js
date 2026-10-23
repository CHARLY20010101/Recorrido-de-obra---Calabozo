// Comunicación con la hoja de Google del proyecto (Apps Script publicado como app web).
// Un proyecto "de archivo" (.json) no tiene servidor: todo queda en el teléfono.

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

export function api(proy) {
  const q = (a, extra = '') => `${proy.url}?a=${a}&k=${encodeURIComponent(proy.k)}${extra}`;
  return {
    remoto: !!proy.url,
    version: () => getJSON(q('version')),
    proyecto: () => getJSON(q('proyecto')),
    observaciones: () => getJSON(q('obs')),
    async enviar(accion, datos) {
      // text/plain evita la consulta previa CORS, que Apps Script no responde
      const r = await fetch(proy.url, { method: 'POST', body: JSON.stringify({ a: accion, k: proy.k, ...datos }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      return j;
    },
  };
}

// Enlace de invitación: ...#p=<base64 de {n, u, k}>
export function leerEnlace(texto) {
  const m = String(texto).match(/#p=([A-Za-z0-9_\-+/=%]+)/);
  if (!m) return null;
  try {
    const b = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
    const j = JSON.parse(decodeURIComponent(escape(atob(b))));
    if (!j.u || !j.k) return null;
    return { nombre: j.n || 'Proyecto', url: j.u, k: j.k };
  } catch { return null; }
}
