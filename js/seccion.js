// Sección típica: lectura de la hoja SECCION_TIPICA y dibujo esquemático (SVG) del paquete
// estructural. Las capas se exageran en vertical para que se lean; los anchos van a escala.

const num = (v) => (v === '' || v == null ? null : +String(v).replace(',', '.'));

// "TS capa 2:1.0; TS capa 1:1.3; Base:20; Sub base:22" → [{nombre, cm}], de arriba hacia abajo
export function leerCapas(txt) {
  return String(txt || '').split(';').map((s) => s.split(':')).filter((p) => p.length === 2 && p[0].trim())
    .map(([n, e]) => ({ nombre: n.trim(), cm: num(e.trim()) })).filter((c) => c.cm > 0);
}

export function leerSecciones(filas) {
  return (filas || []).map((r) => ({
    nombre: r.NOMBRE || 'Sección típica', ini: num(r.PROG_INI) ?? -Infinity, fin: num(r.PROG_FIN) ?? Infinity,
    carril: num(r.CARRIL_M) ?? 0, berma: num(r.BERMA_M) ?? 0, bombeo: num(r.BOMBEO_PCT) ?? 0,
    cunetaAncho: num(r.CUNETA_ANCHO_M), cunetaProf: num(r.CUNETA_PROF_M),
    capas: leerCapas(r.CAPAS), taludCorte: r.TALUD_CORTE || '', taludRelleno: r.TALUD_RELLENO || '',
    fuente: r.FUENTE || '', obs: r.OBS || '',
  })).filter((s) => s.carril > 0);
}

export const seccionEn = (secciones, prog) => secciones.find((s) => prog >= s.ini && prog <= s.fin) || null;

const COLORES = ['#263238', '#546e7a', '#a1887f', '#d7ccc8', '#efebe9', '#bdbdbd'];
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Esquema a media ladera: relleno a la izquierda, cuneta y corte a la derecha.
// lado interno de curva ('LI'/'LD') opcional: se marca dónde va el sobreancho.
export function svgSeccion(s, { sobreancho = null } = {}) {
  const PX = 38, X0 = 100, YC = 64, EXB = 4, KCM = 0.9;     // px por metro, borde izq., cota de la corona, exageraciones
  const semi = s.carril + s.berma, ancho = 2 * semi;
  const xi = X0, xd = X0 + ancho * PX, xc = (xi + xd) / 2;
  const caida = semi * (s.bombeo / 100) * PX * EXB;            // bombeo exagerado para que se vea
  const yBorde = YC + caida;
  const sup = (x) => YC + Math.abs(x - xc) / (xd - xc) * caida; // superficie a dos aguas
  const espesores = s.capas.map((c) => Math.max(3, c.cm * KCM));
  const total = espesores.reduce((a, b) => a + b, 0);
  let capas = '', acum = 0;
  s.capas.forEach((c, i) => {
    const a = acum, b = acum + espesores[i];
    const pts = [[xi, sup(xi) + a], [xc, YC + a], [xd, sup(xd) + a], [xd, sup(xd) + b], [xc, YC + b], [xi, sup(xi) + b]];
    capas += `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${COLORES[i] || '#ccc'}"${i >= 2 ? ' fill-opacity=".95"' : ''} stroke="#3e2723" stroke-width=".4"/>`;
    if (i >= 2) capas += `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="url(#granular)"/>`;
    acum = b;
  });
  const yFondo = yBorde + total;
  // relleno (izquierda) con talud 1:1.5 y corte (derecha) con talud 4:1
  const relleno = `<polygon points="${xi},${yBorde} ${xi},${yFondo} ${xi - 30},${yFondo + 42} ${xi - 30 - 60},${yFondo + 42}" fill="#c8e6c9" stroke="#2e7d32" stroke-width=".8"/>`;
  const cw = (s.cunetaAncho || 0.75) * PX, cp = Math.max(12, (s.cunetaProf || 0.3) * PX * 1.6);
  const xCun = xd, xCunF = xd + cw;
  const cuneta = s.cunetaAncho ? `<polygon points="${xCun},${yBorde} ${xCun + cw * .62},${yBorde + cp} ${xCunF},${yBorde - 4}" fill="#cfd8dc" stroke="#455a64" stroke-width="1.6" stroke-linejoin="round"/>` : '';
  const xCorte = s.cunetaAncho ? xCunF : xd;
  const corte = `<polygon points="${xCorte},${yBorde - 4} ${xCorte + 14},${yBorde - 60} ${xCorte + 60},${yBorde - 60} ${xCorte + 60},${yFondo + 42} ${xi},${yFondo + 42} ${xi},${yFondo} ${xd},${yFondo}${s.cunetaAncho ? ` ${xd},${yBorde} ${xCun + cw * .62},${yBorde + cp} ${xCunF},${yBorde - 4}` : ''}" fill="url(#corte)" stroke="#e65100" stroke-width=".8"/>`;
  // cotas
  const cota = (x1, x2, y, txt, color = '#0f2a3d') => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width=".8" marker-start="url(#fl)" marker-end="url(#fl)"/>
    <text x="${(x1 + x2) / 2}" y="${y - 3}" font-size="8.5" text-anchor="middle" fill="${color}" font-weight="700">${txt}</text>`;
  const xs = [xi, xi + s.berma * PX, xc, xd - s.berma * PX, xd];
  const cotas = cota(xs[0], xs[1], 40, f2(s.berma)) + cota(xs[1], xs[2], 40, `Carril ${f2(s.carril)}`) + cota(xs[2], xs[3], 40, `Carril ${f2(s.carril)}`) + cota(xs[3], xs[4], 40, f2(s.berma))
    + cota(xs[1], xs[3], 24, `Calzada ${f2(2 * s.carril)} m`) + cota(xs[0], xs[4], 10, `Plataforma ${f2(ancho)} m`, '#5f6b76');
  const bombeo = s.bombeo ? `<text x="${(xi + xc) / 2}" y="${YC + caida / 2 - 4}" font-size="8" text-anchor="middle" fill="#0f2a3d">← ${s.bombeo}%</text>
    <text x="${(xc + xd) / 2}" y="${YC + caida / 2 - 4}" font-size="8" text-anchor="middle" fill="#0f2a3d">${s.bombeo}% →</text>` : '';
  const cunTxt = s.cunetaAncho ? `<text x="${xCun + cw / 2}" y="${yBorde + cp + 11}" font-size="8" text-anchor="middle" fill="#455a64">Cuneta ${f2(s.cunetaAncho)}×${f2(s.cunetaProf || 0)}</text>` : '';
  const sobre = sobreancho ? `<text x="${sobreancho === 'LI' ? xi + 4 : xd - 4}" y="${yFondo + 12}" font-size="8.5" font-weight="700" fill="#c62828" text-anchor="${sobreancho === 'LI' ? 'start' : 'end'}">${sobreancho === 'LI' ? '◀ sobreancho (curva)' : 'sobreancho (curva) ▶'}</text>` : '';
  const leyenda = s.capas.map((c, i) => `<g transform="translate(${8 + (i % 2) * 176},${yFondo + 58 + Math.floor(i / 2) * 15})">
      <rect width="14" height="10" fill="${COLORES[i] || '#ccc'}" stroke="#3e2723" stroke-width=".4"/>${i >= 2 ? '<rect width="14" height="10" fill="url(#granular)"/>' : ''}
      <text x="19" y="9" font-size="9" fill="#1b1f23">${esc(c.nombre)} · <tspan font-weight="700">${String(c.cm).replace('.', ',')} cm</tspan></text></g>`).join('');
  const alto = yFondo + 62 + Math.ceil(s.capas.length / 2) * 15;
  return `<svg viewBox="0 0 ${xCorte + 66} ${alto}" width="100%" role="img" aria-label="Esquema de la sección típica" style="max-width:520px;display:block;margin:auto">
    <defs>
      <marker id="fl" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 6,3 0,6z" fill="currentColor"/></marker>
      <pattern id="granular" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".7" fill="#5d4037" fill-opacity=".55"/></pattern>
      <pattern id="corte" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#fff3e0"/><line x1="0" y1="0" x2="0" y2="7" stroke="#ef6c00" stroke-width="1.2" stroke-opacity=".55"/></pattern>
    </defs>
    ${corte}${relleno}${capas}${cuneta}${cotas}${bombeo}${cunTxt}${sobre}
    <text x="${xi - 58}" y="${yFondo + 30}" font-size="8" fill="#2e7d32">Relleno</text>
    <text x="${xCorte + 22}" y="${yBorde - 30}" font-size="8" fill="#e65100">Corte</text>
    ${leyenda}
  </svg>`;
}
