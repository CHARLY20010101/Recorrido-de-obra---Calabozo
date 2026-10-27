// Geodesia y cálculo de progresivas sobre el eje.
// Coordenadas del proyecto en UTM (WGS84); el GPS entrega latitud/longitud.

const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
const RAD = Math.PI / 180;

const lon0 = (zona) => ((zona - 1) * 6 - 180 + 3) * RAD;

export function utmALatLon(E, N, zona, sur) {
  const x = E - 500000, y = sur ? N - 10000000 : N;
  const mu = y / K0 / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const p1 = mu + (3 * E1 / 2 - 27 * E1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * E1 * E1 / 16 - 55 * E1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * E1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * E1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const N1 = A / Math.sqrt(1 - E2 * s * s), T1 = t * t, C1 = EP2 * c * c;
  const R1 = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5), D = x / (N1 * K0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0(zona) + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [lat / RAD, lon / RAD];
}

export function latLonAUtm(lat, lon, zona, sur) {
  const p = lat * RAD, s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
  const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, Aa = c * (lon * RAD - lon0(zona));
  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * p
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
  const E = K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120) + 500000;
  let Nn = K0 * (M + N * t * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720));
  if (sur) Nn += 10000000;
  return [E, Nn];
}

// "12+345" a partir de metros
export function fmtProg(p, dec = 0) {
  if (p == null || isNaN(p)) return '—';
  const f = 10 ** dec, r = Math.round(p * f) / f;
  const km = Math.floor(r / 1000), m = r - km * 1000;
  const ent = Math.floor(m + 1e-9), fr = dec ? (m - ent).toFixed(dec).slice(1) : '';
  return `${km}+${String(ent).padStart(3, '0')}${fr}`;
}

// Acepta "12+500", "12+500.5", "12500", "12.5k"
export function parseProg(txt) {
  const s = String(txt).trim().replace(',', '.');
  let m = s.match(/^(\d+)\s*\+\s*(\d+(?:\.\d+)?)$/);
  if (m) return +m[1] * 1000 + +m[2];
  m = s.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (m) return +m[1] * 1000;
  return /^\d+(\.\d+)?$/.test(s) ? +s : null;
}

// Lado respecto de quien mira: "off" ya debe venir orientado al sentido de avance
export function fmtLado(off) {
  if (off == null) return '';
  const d = Math.abs(off);
  if (d < 1) return 'Sobre el eje';
  return `${off < 0 ? 'Izq.' : 'Der.'} ${d < 10 ? d.toFixed(1) : Math.round(d)} m`;
}

// Lado según la convención de planos (sentido de la progresiva): LI / LD
export function fmtLadoProg(off) {
  if (off == null) return '';
  const d = Math.abs(off);
  if (d < 1) return 'Eje';
  return `${off < 0 ? 'LI' : 'LD'} ${d < 10 ? d.toFixed(1) : Math.round(d)} m`;
}

// Eje como polilínea con progresiva acumulada en cada vértice.
export class Eje {
  constructor(filas, zona, sur) {
    // filas: [[E, N, PROG], ...]; si falta PROG se calcula por distancia
    this.zona = zona; this.sur = sur;
    const n = filas.length;
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.p = new Float64Array(n);
    let acc = filas[0][2] != null && filas[0][2] !== '' ? +filas[0][2] : 0;
    for (let i = 0; i < n; i++) {
      this.x[i] = +filas[i][0]; this.y[i] = +filas[i][1];
      if (i > 0) acc += Math.hypot(this.x[i] - this.x[i - 1], this.y[i] - this.y[i - 1]);
      const pr = filas[i][2];
      this.p[i] = pr != null && pr !== '' ? +pr : acc;
    }
    this.inicio = this.p[0]; this.fin = this.p[n - 1];
  }

  latlngs() {
    const out = new Array(this.x.length);
    for (let i = 0; i < out.length; i++) out[i] = utmALatLon(this.x[i], this.y[i], this.zona, this.sur);
    return out;
  }

  // Proyecta un punto UTM sobre el eje. Si se da la progresiva anterior, prefiere
  // el tramo cercano a ella (evita saltar entre curvas de herradura vecinas).
  ubicar(E, N, progAnterior = null) {
    let best = null, local = null;
    for (let i = 0; i < this.x.length - 1; i++) {
      const dx = this.x[i + 1] - this.x[i], dy = this.y[i + 1] - this.y[i];
      const L2 = dx * dx + dy * dy;
      if (!L2) continue;
      let t = ((E - this.x[i]) * dx + (N - this.y[i]) * dy) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = this.x[i] + t * dx, qy = this.y[i] + t * dy;
      const d = Math.hypot(E - qx, N - qy);
      if (!best || d < best.d) best = { i, t, d };
      if (progAnterior != null) {
        const pr = this.p[i] + t * (this.p[i + 1] - this.p[i]);
        if (Math.abs(pr - progAnterior) < 300 && (!local || d < local.d)) local = { i, t, d };
      }
    }
    const r = local && local.d < best.d + 15 ? local : best;
    const { i, t } = r;
    const dx = this.x[i + 1] - this.x[i], dy = this.y[i + 1] - this.y[i];
    const cruz = dx * (N - this.y[i]) - dy * (E - this.x[i]);
    return {
      prog: this.p[i] + t * (this.p[i + 1] - this.p[i]),
      off: (cruz > 0 ? -1 : 1) * r.d, // negativo = izquierda, positivo = derecha
      dist: r.d,
      az: (Math.atan2(dx, dy) / RAD + 360) % 360, // rumbo del eje (progresiva creciente), grados desde el norte
    };
  }

  // Punto UTM en una progresiva, desplazado "off" metros (+ derecha, - izquierda)
  punto(prog, off = 0) {
    const p = this.p;
    let lo = 0, hi = p.length - 1;
    if (prog <= p[0]) hi = 1; else if (prog >= p[hi]) lo = hi - 1;
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m] <= prog) lo = m; else hi = m; }
    const dx = this.x[hi] - this.x[lo], dy = this.y[hi] - this.y[lo];
    const L = Math.hypot(dx, dy) || 1, t = (prog - p[lo]) / ((p[hi] - p[lo]) || 1);
    return [this.x[lo] + t * dx + off * dy / L, this.y[lo] + t * dy - off * dx / L];
  }

  puntoLatLon(prog, off = 0) {
    const [E, N] = this.punto(prog, off);
    return utmALatLon(E, N, this.zona, this.sur);
  }

  // Tramo del eje entre dos progresivas, como lista de latlng
  tramoLatLon(p1, p2, off = 0) {
    const a = Math.max(Math.min(p1, p2), this.inicio), b = Math.min(Math.max(p1, p2), this.fin);
    const pts = [this.puntoLatLon(a, off)];
    for (let i = 0; i < this.p.length; i++) if (this.p[i] > a && this.p[i] < b) pts.push(this.puntoLatLon(this.p[i], off));
    pts.push(this.puntoLatLon(b, off));
    return pts;
  }
}
