// Metrados ejecutados (fase 3): partidas del contrato, avance por partida y metrado propuesto con las
// secciones transversales. Lo que vale es el metrado verificado en campo: el cálculo solo ayuda a llenarlo.

export const ESTADOS_MET = ['REGISTRADO', 'VERIFICADO', 'OBSERVADO', 'ANULADO', 'VALORIZADO'];
// solo esto suma al avance oficial
export const cuenta = (m) => m.estado === 'VERIFICADO' || m.estado === 'VALORIZADO';
// registrado o corregido, esperando verificación
export const porVerificar = (m) => m.estado === 'REGISTRADO';
export const LADOS_MET = [['', 'Toda la sección'], ['LI', 'Izquierdo (LI)'], ['LD', 'Derecho (LD)'], ['AMBOS', 'Ambos lados']];

const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);

export function leerPartidas(lista) {
  return (lista || []).filter((p) => p.item).map((p) => ({
    item: String(p.item), desc: String(p.desc || ''), und: String(p.und || ''), contrato: num(p.contrato),
    titulo: String(p.nivel || '').toUpperCase() === 'TITULO', herramienta: p.herramienta || '', criterio: p.criterio || '',
    calculo: String(p.calculo || '').toUpperCase(), obs: p.obs || '',
  }));
}

export function leerMetrados(lista) {
  return (lista || []).filter((m) => m.id).map((m) => ({
    ...m, id: String(m.id), partida: String(m.partida || ''), cantidad: +m.cantidad || 0, ini: num(m.ini), fin: num(m.fin),
    lado: String(m.lado || ''), estado: m.estado || 'REGISTRADO', fotos: m.fotos || [],
  })).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.registrado || '').localeCompare(a.registrado || ''));
}

// Avance por partida: verificado (oficial) y por verificar
export function avance(metrados) {
  const a = {};
  for (const m of metrados) {
    if (m.estado === 'ANULADO') continue;
    const x = (a[m.partida] ||= { ver: 0, pend: 0, obs: 0, n: 0 });
    x.n++;
    if (cuenta(m)) x.ver += m.cantidad; else if (m.estado === 'OBSERVADO') x.obs += m.cantidad; else x.pend += m.cantidad;
  }
  return a;
}

// Título de primer nivel bajo el que va una partida (01.02.02 -> 01.02), para agrupar la lista
export const grupoDe = (item) => item.split('.').slice(0, 2).join('.');

// ---- cálculo propuesto con las secciones ----
export const UNIDAD_CALCULO = {
  CORTE: 'm³', RELLENO: 'm³', SUBBASE: 'm³', BASE: 'm³', SUPERFICIE: 'm²', DESBROCE: 'ha', LONGITUD_KM: 'km', LONGITUD_M: 'm', CONTEO: 'und',
};
const NECESITA_SECCIONES = ['CORTE', 'RELLENO', 'SUBBASE', 'BASE', 'DESBROCE'];

// Área de un polígono [x, z, x, z…] (fórmula del topógrafo)
function area(flat) {
  let s = 0;
  for (let i = 0, n = flat.length; i < n; i += 2) {
    const j = (i + 2) % n;
    s += flat[i] * flat[j + 1] - flat[j] * flat[i + 1];
  }
  return Math.abs(s) / 2;
}

// Recorta un polígono al lado izquierdo (x <= 0) o derecho (x >= 0) del eje
function recortar(flat, lado) {
  const dentro = (x) => (lado === 'LI' ? x <= 0 : x >= 0);
  const out = [];
  for (let i = 0, n = flat.length; i < n; i += 2) {
    const ax = flat[i], az = flat[i + 1], j = (i + 2) % n, bx = flat[j], bz = flat[j + 1];
    if (dentro(ax)) out.push(ax, az);
    if (dentro(ax) !== dentro(bx)) out.push(0, az + (bz - az) * (0 - ax) / (bx - ax));
  }
  return out;
}

const areaCapa = (polis, lado) => (polis || []).reduce((s, p) => s + area(lado === 'LI' || lado === 'LD' ? recortar(p, lado) : p), 0);
// Ancho horizontal de una capa (suma de sus franjas), del lado pedido
function ancho(polis, lado) {
  let s = 0;
  for (const p of polis || []) {
    let xs = p.filter((_, i) => i % 2 === 0);
    if (lado === 'LI') xs = xs.map((x) => Math.min(x, 0)); else if (lado === 'LD') xs = xs.map((x) => Math.max(x, 0));
    s += Math.max(...xs) - Math.min(...xs);
  }
  return s;
}
// Ancho entre chaflanes: de la línea de proyecto y los polígonos de corte y relleno
function anchoChaflanes(s, lado) {
  const xs = [...(s.sr || []).filter((_, i) => i % 2 === 0), ...[...(s.corte || []), ...(s.relleno || [])].flatMap((p) => p.filter((_, i) => i % 2 === 0))];
  if (!xs.length) return 0;
  const a = Math.min(...xs), b = Math.max(...xs);
  return lado === 'LI' ? Math.max(0, -a) : lado === 'LD' ? Math.max(0, b) : b - a;
}

// Integra una cantidad por sección (área o ancho) a lo largo del tramo, interpolando en los extremos.
// No inventa nada donde faltan secciones (separación > 200 m).
export function integrar(secs, ini, fin, f) {
  let total = 0, cubierto = 0;
  for (let i = 0; i + 1 < secs.length; i++) {
    const a = secs[i], b = secs[i + 1], d = b.p - a.p;
    if (d <= 0 || d > 200) continue;
    const x0 = Math.max(a.p, ini), x1 = Math.min(b.p, fin);
    if (x1 <= x0) continue;
    const fa = f(a), fb = f(b), v = (x) => fa + (fb - fa) * (x - a.p) / d;
    total += (v(x0) + v(x1)) / 2 * (x1 - x0);
    cubierto += x1 - x0;
  }
  return { total, cubierto };
}

const fmt = (v, d = 2) => v.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

// Propone la cantidad de una partida en un tramo. secc = {fuente, nombre, secs} (o null), tipica = sección típica.
// Devuelve {valor, und, detalle, aviso} o {error}.
export function calcular(metodo, { ini, fin, lado = '', secc = null, tipica = null, pct = 100 }) {
  if (!metodo) return { error: 'Esta partida no tiene cálculo automático: escribe el metrado medido.' };
  const und = UNIDAD_CALCULO[metodo];
  if (metodo === 'CONTEO') return { valor: 1, und, detalle: '1 unidad' };
  if (ini == null || fin == null || !(fin > ini)) return { error: 'Escribe la progresiva de inicio y la de fin del tramo.' };
  const L = fin - ini;
  if (metodo === 'LONGITUD_KM') return { valor: L / 1000, und, detalle: `Longitud del tramo: ${fmt(L)} m` };
  if (metodo === 'LONGITUD_M') {
    const k = lado === 'AMBOS' ? 2 : 1;
    return { valor: L * k, und, detalle: `Longitud del tramo ${fmt(L)} m${k > 1 ? ' × 2 lados' : ''}` };
  }
  const medio = lado === 'LI' || lado === 'LD';
  const txtLado = medio ? ` · solo lado ${lado}` : '';
  if (!secc?.secs?.length) {
    // sin secciones: la superficie sale de la sección típica; lo demás necesita secciones
    if (metodo === 'SUPERFICIE' && tipica) {
      const w = 2 * (tipica.carril + tipica.berma) / (medio ? 2 : 1);
      return { valor: w * L, und, detalle: `Ancho de la sección típica ${fmt(w)} m × ${fmt(L)} m${txtLado}`, aviso: 'No hay secciones de este tramo: se usó la sección típica (sin sobreanchos).' };
    }
    return { error: NECESITA_SECCIONES.includes(metodo) || metodo === 'SUPERFICIE' ? 'No hay secciones transversales descargadas para este tramo.' : 'Cálculo no disponible.' };
  }
  const por = {
    CORTE: (s) => (medio ? areaCapa(s.corte, lado) : s.ac || 0),
    RELLENO: (s) => (medio ? areaCapa(s.relleno, lado) : s.ar || 0),
    SUBBASE: (s) => areaCapa(s.sb, lado),
    BASE: (s) => areaCapa(s.bg, lado),
    SUPERFICIE: (s) => ancho(s.ts, lado),
    DESBROCE: (s) => anchoChaflanes(s, lado),
  }[metodo];
  if (!por) return { error: 'Cálculo no disponible.' };
  const r = integrar(secc.secs, ini, fin, por);
  if (!r.cubierto) return { error: `No hay secciones de ${secc.nombre} entre ${ini} y ${fin}.` };
  const n = secc.secs.filter((s) => s.p >= ini - 20 && s.p <= fin + 20).length;
  let valor = r.total, detalle;
  if (metodo === 'DESBROCE') { valor = r.total / 10000; detalle = `Ancho entre chaflanes × largo (áreas medias), ${n} secciones de ${secc.nombre}${txtLado}`; }
  else if (metodo === 'SUPERFICIE') detalle = `Ancho de la rodadura × largo, ${n} secciones de ${secc.nombre}${txtLado}`;
  else detalle = `Áreas medias, ${n} secciones de ${secc.nombre}${txtLado}`;
  if (metodo === 'CORTE' && pct !== 100) { valor *= pct / 100; detalle += ` × ${fmt(pct, 0)} % de este material`; }
  const falta = L - r.cubierto;
  return {
    valor, und, detalle,
    aviso: [falta > 1 ? `Faltan secciones en ${fmt(falta, 0)} m del tramo: no se contaron.` : '',
      secc.fuente === 'EXPEDIENTE' ? 'Calculado con las secciones del expediente (referencial): el pago se sustenta con la línea base y el control de lo ejecutado.' : ''].filter(Boolean).join(' '),
  };
}

// ---- exportación a Excel: filas con los números como números ----
const r4 = (v) => (v == null ? '' : Math.round(v * 10000) / 10000);
// Para la hoja VALORIZACION: solo lo verificado es metrado del periodo; lo pendiente va aparte
export function filasResumen(partidas, metrados, desde, hasta) {
  const filas = [['Item', 'Descripción', 'Und', 'Metrado contrato', 'Acumulado anterior', 'Metrado del periodo', 'Acumulado actual', '% avance', 'Saldo',
    'Por verificar (periodo)', 'Registros del periodo']];
  for (const p of partidas) {
    if (p.titulo) { filas.push([p.item, p.desc]); continue; }
    const ms = metrados.filter((m) => m.partida === p.item && m.estado !== 'ANULADO');
    const ant = ms.filter((m) => cuenta(m) && m.fecha < desde).reduce((s, m) => s + m.cantidad, 0);
    const del = ms.filter((m) => m.fecha >= desde && m.fecha <= hasta);
    const per = del.filter(cuenta).reduce((s, m) => s + m.cantidad, 0);
    const pend = del.filter((m) => !cuenta(m)).reduce((s, m) => s + m.cantidad, 0);
    const acu = ant + per;
    filas.push([p.item, p.desc, p.und, r4(p.contrato), r4(ant), r4(per), r4(acu), p.contrato ? r4(100 * acu / p.contrato) : '', p.contrato != null ? r4(p.contrato - acu) : '',
      r4(pend), del.length || '']);
  }
  return filas;
}

export function filasDetalle(partidas, metrados, desde, hasta, fmtProg) {
  const desc = Object.fromEntries(partidas.map((p) => [p.item, p.desc]));
  const filas = [['Fecha', 'Item', 'Partida', 'Prog. inicio', 'Prog. fin', 'Lado', 'Cantidad', 'Und', 'Estado', 'Cálculo', 'Sustento', 'Asiento', 'Elemento', 'Frente',
    'Nota de revisión', 'Registrado por', 'Revisado por', 'Fotos', 'Observación', 'ID']];
  for (const m of [...metrados].reverse()) {
    if (m.fecha < desde || m.fecha > hasta) continue;
    filas.push([m.fecha, m.partida, desc[m.partida] || '', m.ini != null ? fmtProg(m.ini) : '', m.fin != null ? fmtProg(m.fin) : '', m.lado, r4(m.cantidad), m.und, m.estado,
      m.calculo, m.sustento, m.asiento, m.elemento, m.frente, m.nota, m.registradoPor, m.revisadoPor, (m.fotos || []).length || '', m.obs, m.id]);
  }
  return filas;
}
