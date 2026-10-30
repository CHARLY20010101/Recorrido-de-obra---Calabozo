// Sección transversal dibujada como en el plano: grilla rotulada (distancia al eje y cota), terreno,
// línea de proyecto (subrasante, cunetas y taludes), capas del pavimento y achurados de corte y relleno.
// Las coordenadas vienen planas [x1, z1, x2, z2, …] en metros (x + = derecha del eje).

export const FUENTES = {
  EXPEDIENTE: ['Expediente', '#6d4c41'],
  LINEA_BASE: ['Línea base', '#8e24aa'],
  REPLANTEO: ['Replanteo', '#00897b'],
  CONTROL: ['Control', '#e53935'],
  OTRO: ['Otra fuente', '#546e7a'],
};
export const nombreFuente = (f) => (FUENTES[f] || FUENTES.OTRO)[0];
export const colorFuente = (f) => (FUENTES[f] || FUENTES.OTRO)[1];

const pares = (a) => { const r = []; for (let i = 0; i + 1 < (a?.length || 0); i += 2) r.push([a[i], a[i + 1]]); return r; };

// Corte, relleno, media ladera o a nivel, por la proporción de áreas
export function tipoSeccion(s) {
  const ac = s.ac || 0, ar = s.ar || 0;
  if (ac + ar < 0.3) return 'a nivel';
  const r = ar / (ac + ar);
  return r < 0.15 ? 'corte' : r > 0.85 ? 'relleno' : 'media ladera';
}

// Cota de una línea en la distancia x (null si x queda fuera)
export function cotaEn(flat, x) {
  const p = pares(flat).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i + 1 < p.length; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[i + 1];
    if (x >= x1 && x <= x2 && x2 > x1) return z1 + (z2 - z1) * (x - x1) / (x2 - x1);
  }
  return null;
}

// principal: {s, fuente}; otras: terrenos de otras fuentes en la misma progresiva, para comparar.
// recorte: solo la zona de la obra (plataforma, cunetas y taludes) con unos metros de terreno a cada lado,
// para que en la ficha se lea bien; sin recorte, todo el ancho levantado (para el visor).
export function svgTransversal(principal, otras = [], { recorte = false } = {}) {
  const s = principal.s, K = 10; // 10 unidades por metro
  const obra = [s.sr, ...(s.corte || []), ...(s.relleno || []), ...(s.sb || [])].flatMap(pares);
  const todas = [s.tn, ...otras.map((o) => o.s.tn)].flatMap(pares).concat(obra);
  if (!todas.length) return '';
  let x0, x1;
  if (recorte && obra.length) {
    x0 = Math.min(...obra.map((p) => p[0])) - 3; x1 = Math.max(...obra.map((p) => p[0])) + 3;
    if (x1 - x0 < 14) { const m = (x0 + x1) / 2; x0 = m - 7; x1 = m + 7; }
  } else { x0 = Math.min(...todas.map((p) => p[0])); x1 = Math.max(...todas.map((p) => p[0])); }
  const pts = todas.filter((p) => p[0] >= x0 - 0.01 && p[0] <= x1 + 0.01);
  let z0 = Math.min(...pts.map((p) => p[1])), z1 = Math.max(...pts.map((p) => p[1]));
  for (const f of [s.tn, ...otras.map((o) => o.s.tn)]) { // el terreno en los bordes del recorte también cuenta
    for (const x of [x0, x1]) { const z = cotaEn(f, x); if (z != null) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); } }
  }
  // grilla de 2 m (o 5 m si la sección es muy alta), con margen para los rótulos
  const paso = z1 - z0 > 30 || x1 - x0 > 60 ? 5 : x1 - x0 < 20 ? 1 : 2;
  x0 = Math.floor(x0 / paso) * paso; x1 = Math.ceil(x1 / paso) * paso;
  z0 = Math.floor((z0 - 0.5) / paso) * paso; z1 = Math.ceil((z1 + 0.5) / paso) * paso;
  const mx = 3.2, mb = 2.2, mt = 0.8; // márgenes en metros: izquierda (cotas), abajo (distancias), arriba
  const W = (x1 - x0 + mx + 0.8) * K, H = (z1 - z0 + mb + mt) * K;
  const X = (x) => ((x - x0 + mx) * K).toFixed(1), Y = (z) => ((z1 - z + mt) * K).toFixed(1);
  const pl = (flat) => pares(flat).map(([x, z]) => `${X(x)},${Y(z)}`).join(' ');
  const fs = Math.max(5, Math.min(9, (x1 - x0) / 4.5)); // tamaño de letra en unidades (≈ 0.5 a 0.9 m)
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="Arial, sans-serif">`);
  out.push(`<defs>
    <pattern id="pc" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#ef6c00" stroke-width="1.2"/></pattern>
    <pattern id="pr" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".9" fill="#558b2f"/><circle cx="5.5" cy="5" r=".7" fill="#558b2f"/></pattern>
    <pattern id="pb" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#eceff1"/><circle cx="2.5" cy="2.5" r=".6" fill="#90a4ae"/></pattern>
  </defs><rect width="100%" height="100%" fill="#fff"/>`);
  // grilla
  for (let x = x0; x <= x1 + 1e-6; x += paso) {
    out.push(`<line x1="${X(x)}" y1="${Y(z1)}" x2="${X(x)}" y2="${Y(z0)}" stroke="${x === 0 ? '#c62828' : '#dfe4e8'}" stroke-width="${x === 0 ? 1.2 : .8}"${x === 0 ? ' stroke-dasharray="10 4 2 4"' : ''}/>`);
    out.push(`<text x="${X(x)}" y="${(+Y(z0) + fs * 1.3).toFixed(1)}" font-size="${fs}" text-anchor="middle" fill="#455a64">${x}</text>`);
  }
  for (let z = z0; z <= z1 + 1e-6; z += paso) {
    out.push(`<line x1="${X(x0)}" y1="${Y(z)}" x2="${X(x1)}" y2="${Y(z)}" stroke="#dfe4e8" stroke-width=".8"/>`);
    out.push(`<text x="${(+X(x0) - fs * .4).toFixed(1)}" y="${(+Y(z) + fs * .35).toFixed(1)}" font-size="${fs}" text-anchor="end" fill="#455a64">${z}</text>`);
  }
  out.push(`<rect x="${X(x0)}" y="${Y(z1)}" width="${((x1 - x0) * K).toFixed(1)}" height="${((z1 - z0) * K).toFixed(1)}" fill="none" stroke="#90a4ae" stroke-width="1"/>`);
  // el dibujo se corta en el marco de la grilla (con recorte, el terreno sigue más allá)
  out.push(`<clipPath id="marco"><rect x="${X(x0)}" y="${Y(z1)}" width="${((x1 - x0) * K).toFixed(1)}" height="${((z1 - z0) * K).toFixed(1)}"/></clipPath><g clip-path="url(#marco)">`);
  // corte y relleno (achurados como en el plano)
  for (const c of s.corte || []) out.push(`<polygon points="${pl(c)}" fill="url(#pc)" stroke="#ef6c00" stroke-width=".8"/>`);
  for (const c of s.relleno || []) out.push(`<polygon points="${pl(c)}" fill="#f1f8e9" stroke="#7cb342" stroke-width=".8"/><polygon points="${pl(c)}" fill="url(#pr)"/>`);
  // pavimento: subbase, base y rodadura
  for (const c of s.sb || []) out.push(`<polygon points="${pl(c)}" fill="#f3e0b5" stroke="#a1887f" stroke-width=".6"/>`);
  for (const c of s.bg || []) out.push(`<polygon points="${pl(c)}" fill="url(#pb)" stroke="#78909c" stroke-width=".6"/>`);
  for (const c of s.ts || []) out.push(`<polygon points="${pl(c)}" fill="#37474f" stroke="#263238" stroke-width="1.2"/>`);
  // terrenos de otras fuentes (para comparar) y el principal
  for (const o of otras) out.push(`<polyline points="${pl(o.s.tn)}" fill="none" stroke="${colorFuente(o.fuente)}" stroke-width="2" stroke-dasharray="7 4"/>`);
  out.push(`<polyline points="${pl(s.sr)}" fill="none" stroke="#0d47a1" stroke-width="1.8" stroke-linejoin="round"/>`);
  out.push(`<polyline points="${pl(s.tn)}" fill="none" stroke="${colorFuente(principal.fuente)}" stroke-width="2.2" stroke-linejoin="round"/>`);
  out.push('</g>');
  out.push(`<text x="${(+X(0) + 3).toFixed(1)}" y="${(+Y(z1) + fs * 1.1).toFixed(1)}" font-size="${fs}" fill="#c62828" font-weight="bold">EJE</text>`);
  out.push('</svg>');
  return out.join('');
}
