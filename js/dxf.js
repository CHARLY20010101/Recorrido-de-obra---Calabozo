// Lectura de polilíneas (LWPOLYLINE) de un DXF, con sus arcos (bulge) convertidos a puntos.

export function leerPolilineas(texto) {
  const l = texto.split(/\r?\n/);
  const out = [];
  let i = 0, enEntidades = false, actual = null;
  const cerrar = () => { if (actual && actual.v.length > 1) out.push(actual); actual = null; };
  while (i < l.length - 1) {
    const cod = +l[i].trim(), val = l[i + 1].trim();
    i += 2;
    if (cod === 2 && val === 'ENTITIES') enEntidades = true;
    if (!enEntidades) continue;
    if (cod === 0) {
      cerrar();
      if (val === 'ENDSEC') break;
      if (val === 'LWPOLYLINE') actual = { capa: '0', cerrada: false, v: [] };
      continue;
    }
    if (!actual) continue;
    if (cod === 8) actual.capa = val;
    else if (cod === 70) actual.cerrada = (+val & 1) === 1;
    else if (cod === 10) actual.v.push({ x: +val, y: 0, b: 0 });
    else if (cod === 20 && actual.v.length) actual.v[actual.v.length - 1].y = +val;
    else if (cod === 42 && actual.v.length) actual.v[actual.v.length - 1].b = +val;
  }
  cerrar();
  for (const p of out) { p.puntos = densificar(p.v, p.cerrada); p.largo = largo(p.puntos); }
  return out.sort((a, b) => b.largo - a.largo);
}

// Arco entre dos vértices: bulge = tan(ángulo/4); positivo = antihorario.
// Cada punto lleva [x, y, s] con s = longitud real recorrida (en arcos, R·Δθ, no la cuerda).
function densificar(v, cerrada, flecha = 0.05) {
  const pts = [];
  let s = 0;
  const n = cerrada ? v.length : v.length - 1;
  for (let k = 0; k < n; k++) {
    const a = v[k], b = v[(k + 1) % v.length];
    pts.push([a.x, a.y, s]);
    const dx = b.x - a.x, dy = b.y - a.y, c = Math.hypot(dx, dy);
    if (!a.b || !c) { s += c; continue; }
    const sag = a.b * c / 2, r = ((c / 2) ** 2 + sag * sag) / (2 * sag);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = -dy / c, ny = dx / c;
    const cx = mx + nx * (r - sag), cy = my + ny * (r - sag), R = Math.abs(r);
    const th = 4 * Math.atan(a.b), a0 = Math.atan2(a.y - cy, a.x - cx);
    const paso = 2 * Math.acos(Math.max(-1, 1 - flecha / R));
    const m = Math.max(1, Math.ceil(Math.abs(th) / paso));
    for (let j = 1; j < m; j++) {
      const t = a0 + th * j / m;
      pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t), s + R * Math.abs(th) * j / m]);
    }
    s += R * Math.abs(th);
  }
  const u = cerrada ? v[0] : v[v.length - 1];
  pts.push([u.x, u.y, s]);
  return pts;
}

const largo = (p) => p[p.length - 1][2];

// Progresiva de cada punto: [[E, N, PROG], ...]. Los puntos de CSV (sin s) se miden por distancia.
export function conProgresiva(puntos, inicio = 0, invertir = false) {
  let s = 0;
  const conS = puntos.map((q, i) => {
    if (q.length > 2) return q;
    if (i) s += Math.hypot(q[0] - puntos[i - 1][0], q[1] - puntos[i - 1][1]);
    return [q[0], q[1], s];
  });
  const total = conS[conS.length - 1][2];
  const p = invertir ? [...conS].reverse() : conS;
  return p.map((q) => [+q[0].toFixed(3), +q[1].toFixed(3), +(inicio + (invertir ? total - q[2] : q[2])).toFixed(3)]);
}

// CSV simple (coma o punto y coma), primera fila = encabezados
export function leerCSV(texto) {
  const t = texto.replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const filas = [];
  let fila = [], campo = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') q = false; else campo += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n') { fila.push(campo.replace(/\r$/, '')); filas.push(fila); fila = []; campo = ''; }
    else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  const cab = filas.shift().map((c) => c.trim().toUpperCase());
  return filas.filter((f) => f.join('').trim()).map((f) => Object.fromEntries(cab.map((c, i) => [c, (f[i] ?? '').trim()])));
}
