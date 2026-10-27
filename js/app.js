// Recorrido de Obra: mapa del eje, progresiva en vivo, avisos y observaciones.
import { Eje, latLonAUtm, utmALatLon, fmtProg, parseProg, fmtLado, fmtLadoProg } from './geo.js';
import { kv, obsDB, uid } from './store.js';
import { api, leerEnlace } from './api.js';
import { leerExif, reducir } from './fotos.js';
import { iconoElemento, iconoBM, iconoUsuario, miniTipo } from './iconos.js';
import { abrirCamara } from './camara.js';

const VERSION_APP = '1.1.0';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RAD = Math.PI / 180;
const EN_VIA_M = 1000; // más lejos del eje que esto, la app pasa a modo consulta (mira +)

const AJUSTES_BASE = {
  nombre: '', voz: true, vibrar: true, pantalla: true,
  cada: 100, distAviso: 50, fueraEje: 40, tipos: null, // null = todos
};
const CATEGORIAS = ['Calidad', 'Seguridad', 'Avance', 'Medio ambiente', 'Topografía', 'Otro'];
const ESTADOS_OBS = ['ABIERTA', 'EN PROCESO', 'LEVANTADA', 'ANULADA'];
const TIPOS_BASE = {
  ALC: ['Alcantarilla', '#1e88e5'], BAD: ['Badén', '#8e24aa'], PTE: ['Puente / pontón', '#d32f2f'],
  CUN: ['Cuneta', '#00897b'], BAR: ['Barrera de seguridad', '#f9a825'], DME: ['DME', '#6d4c41'],
  AGU: ['Fuente de agua', '#039be5'], PAT: ['Patio de máquinas', '#546e7a'], MCA: ['MCA', '#ef6c00'],
  MUR: ['Muro', '#5d4037'], SEN: ['Señalización', '#7cb342'], OTR: ['Otro', '#757575'],
};

const S = {
  proyectos: [], actual: null, datos: null, eje: null, tipos: {}, elementos: [],
  ajustes: { ...AJUSTES_BASE }, obs: [],
  pos: null, u: null, watch: null, pausado: false, gpsError: '', enVia: false, seguir: true, sim: null, wake: null,
  hist: [], dir: 1, ultTramo: null, avisados: new Set(), fueraCont: 0, avisoFuera: false,
  audioListo: false, encuadrar: false, mkYo: null, circPrec: null,
};
const proyActual = () => S.proyectos.find((p) => p.id === S.actual);

// ================= mapa =================
const mapa = L.map('mapa', { zoomControl: false, attributionControl: true }).setView([-5.1, -78.9], 12);
const capasBase = {
  'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, maxNativeZoom: 18, crossOrigin: 'anonymous', attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
  }),
  'Calles': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: 'anonymous', attribution: '© OpenStreetMap',
  }),
};
capasBase['Satélite'].addTo(mapa);
const G = {
  eje: L.layerGroup().addTo(mapa), km: L.layerGroup().addTo(mapa), cien: L.layerGroup(),
  elem: L.layerGroup().addTo(mapa), bm: L.layerGroup(), obs: L.layerGroup().addTo(mapa), yo: L.layerGroup().addTo(mapa),
};
L.control.layers(capasBase, {
  'Elementos de obra': G.elem, 'Observaciones': G.obs, 'BM / puntos de control': G.bm, 'Marcas cada 100 m': G.cien,
}, { position: 'topright' }).addTo(mapa);
L.control.zoom({ position: 'topleft' }).addTo(mapa);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);
let cienAuto = true;
mapa.on('overlayremove', (e) => { if (e.layer === G.cien) cienAuto = false; });
const zoomClases = () => mapa.getContainer().classList.toggle('lejos', mapa.getZoom() < 14);
mapa.on('zoomend', zoomClases);
zoomClases();
mapa.on('zoomend', () => {
  if (!cienAuto) return;
  if (mapa.getZoom() >= 16) G.cien.addTo(mapa); else G.cien.remove();
});
mapa.on('dragstart', () => { if (S.enVia) setSeguir(false); });
mapa.on('moveend', () => { if (!S.enVia) mostrarCentro(); });

function dibujarProyecto() {
  Object.values(G).forEach((g) => g !== G.yo && g.clearLayers());
  if (!S.eje) return;
  const ll = S.eje.latlngs();
  L.polyline(ll, { color: '#000', weight: 7, opacity: .55, interactive: false }).addTo(G.eje);
  L.polyline(ll, { color: '#ffd54f', weight: 4, opacity: 1 }).addTo(G.eje)
    .on('click', (e) => { const u = ubicarLatLon(e.latlng.lat, e.latlng.lng); L.popup().setLatLng(e.latlng).setContent(`<h3>Km ${fmtProg(u.prog)}</h3>Eje de la vía`).openOn(mapa); });
  const ini = Math.ceil(S.eje.inicio / 100) * 100;
  for (let p = ini; p <= S.eje.fin; p += 100) {
    const pt = S.eje.puntoLatLon(p);
    if (p % 1000 === 0) {
      const menor = (p / 1000) % 5 ? 'km-menor' : '';
      L.marker(pt, { icon: L.divIcon({ className: menor, html: `<div class="etq-km">Km ${p / 1000}</div>`, iconAnchor: [-6, 10] }), interactive: false }).addTo(G.km);
      L.circleMarker(pt, { radius: 5, color: '#fff', weight: 2, fillColor: '#0f2a3d', fillOpacity: 1, interactive: false, className: menor }).addTo(G.km);
    } else {
      L.circleMarker(pt, { radius: 3, color: '#000', weight: 1, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(G.cien);
      L.marker(pt, { icon: L.divIcon({ className: '', html: `<div class="etq-100">${fmtProg(p)}</div>`, iconAnchor: [-6, 7] }), interactive: false }).addTo(G.cien);
    }
  }
  for (const e of S.elementos) {
    const color = colorTipo(e.tipo), off = offLado(e.lado);
    const tramo = e.fin != null && Math.abs(e.fin - e.ini) > 1;
    // tramos: línea de color a lo largo del eje; el icono va en el punto medio
    if (tramo) L.polyline(S.eje.tramoLatLon(e.ini, e.fin, off), { color, weight: 6, opacity: .9 }).bindPopup(() => popupElemento(e)).addTo(G.elem);
    const p = tramo ? (e.ini + e.fin) / 2 : e.ini;
    e.capa = L.marker(S.eje.puntoLatLon(p, off), { icon: iconoElemento(e.tipo, color), title: `${e.codigo} · ${e.desc}`, riseOnHover: true })
      .bindPopup(() => popupElemento(e)).addTo(G.elem);
  }
  for (const b of S.datos.bm || []) {
    const [lat, lon] = utmALatLon(+b.E, +b.N, S.eje.zona, S.eje.sur);
    L.marker([lat, lon], { icon: iconoBM() })
      .bindPopup(`<h3>${esc(b.CODIGO)}</h3>Km ${fmtProg(+b.PROG)} · ${fmtLadoProg(+b.DIST_EJE)}<br>E ${(+b.E).toFixed(3)} · N ${(+b.N).toFixed(3)}`).addTo(G.bm);
  }
  dibujarObs();
}

const offLado = (lado) => (lado === 'LI' ? -5 : lado === 'LD' ? 5 : 0);
const descSinLado = (d) => String(d).replace(/\s*\b(LI|LD)\b/g, '').trim();
// LI/LD de los planos (sentido de la progresiva) convertido al sentido en que avanzas
const ladoRel = (lado) => (!lado ? '' : (lado === 'LI') === (S.dir > 0) ? 'izquierda' : 'derecha');

function popupElemento(e) {
  const d = document.createElement('div');
  const lado = e.lado ? `<br>Lado: ${e.lado === 'LI' ? 'izquierdo (LI)' : 'derecho (LD)'} según la progresiva${S.enVia ? ` · <b>a tu ${ladoRel(e.lado)}</b>` : ''}` : '';
  d.innerHTML = `<h3>${esc(e.codigo)}</h3>${esc(e.desc)}<br>
    <b>Km ${fmtProg(e.ini)}${e.fin != null ? ' – ' + fmtProg(e.fin) : ''}</b>${lado}<br>
    Estado: <span class="etq">${esc(e.estado || '—')}</span>${e.obs ? `<p class="ayuda">${esc(e.obs)}</p>` : ''}
    <button class="btn primario">＋ Observación aquí</button>`;
  d.querySelector('button').onclick = () => { mapa.closePopup(); abrirObs(null, { elemento: e.codigo, prog: e.ini, off: offLado(e.lado), fuente: 'Elemento' }); };
  return d;
}

function dibujarObs() {
  G.obs.clearLayers();
  for (const o of S.obs) {
    if (o.lat == null || o.estado === 'ANULADA') continue;
    const color = o.estado === 'LEVANTADA' ? '#2e7d32' : o.estado === 'EN PROCESO' ? '#1565c0' : '#e65100';
    L.marker([o.lat, o.lon], { icon: L.divIcon({ className: '', html: `<div class="pin-obs" style="background:${color}"><span>!</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26] }) })
      .bindPopup(() => {
        const d = document.createElement('div');
        d.innerHTML = `<h3>${esc(o.categoria)} · Km ${fmtProg(o.prog)}</h3>${esc(o.texto).slice(0, 160)}<br><span class="ayuda">${esc(o.usuario)} · ${new Date(o.fecha).toLocaleString('es-PE')}</span><button class="btn">Ver / editar</button>`;
        d.querySelector('button').onclick = () => { mapa.closePopup(); abrirObs(o.id); };
        return d;
      }).addTo(G.obs);
  }
}

const colorTipo = (t) => (S.tipos[t] || TIPOS_BASE[t] || TIPOS_BASE.OTR)[1];
const nombreTipo = (t) => (S.tipos[t] || TIPOS_BASE[t] || [t])[0];

// ================= posición y progresiva =================
function ubicarLatLon(lat, lon, previa = null) {
  const [E, N] = latLonAUtm(lat, lon, S.eje.zona, S.eje.sur);
  return S.eje.ubicar(E, N, previa);
}

// Modo consulta: sin GPS, en pausa o lejos de la vía, la mira + da la progresiva del centro del mapa
function mostrarCentro() {
  if (!S.eje || S.enVia) return;
  const c = mapa.getCenter(), u = ubicarLatLon(c.lat, c.lng);
  $('#etq-prog').textContent = 'Centro del mapa (mira +)';
  $('#prog').classList.remove('vivo');
  $('#prog').textContent = u.dist < 500 ? fmtProg(u.prog) : '—';
  $('#lado').textContent = u.dist < 500 ? fmtLadoProg(u.off) : 'Lejos del eje';
  $('#proximo').innerHTML = S.pausado ? 'GPS en pausa · ☰ → <b>Reanudar GPS</b>'
    : S.gpsError ? esc(S.gpsError)
    : S.u ? `Estás a <b>${(S.u.dist / 1000).toFixed(1)} km</b> de la vía. Mueve el mapa para consultar progresivas.`
    : 'Buscando señal GPS…';
}

function alPosicion(lat, lon, prec, simulada = false, rumbo = null, vel = null) {
  if (!S.eje) return;
  S.gpsError = '';
  S.pos = { lat, lon, prec, t: Date.now(), simulada, rumbo, vel };
  const u = ubicarLatLon(lat, lon, S.u && Date.now() - S.u.t < 60000 ? S.u.prog : null);
  u.t = Date.now();
  S.u = u;
  actualizarSentido(u, rumbo, vel);
  dibujarYo();

  const enVia = u.dist <= EN_VIA_M;
  if (enVia !== S.enVia) {
    S.enVia = enVia;
    document.body.classList.toggle('recorrido', enVia);
    if (enVia) { setSeguir(true); S.ultTramo = null; }
  }
  if (!enVia) { mostrarCentro(); pintarEstado(); return; }
  if (S.seguir) mapa.setView([lat, lon], Math.max(mapa.getZoom(), 16), { animate: false });
  pintarBarra();
  pintarEstado();
  avisos(u);
}

// Sentido de avance: rumbo del GPS si te mueves; si no, cómo cambió la progresiva en los últimos 20 s
function actualizarSentido(u, rumbo, vel) {
  S.hist.push({ t: u.t, p: u.prog });
  while (S.hist.length && u.t - S.hist[0].t > 20000) S.hist.shift();
  const antes = S.dir;
  if (rumbo != null && !isNaN(rumbo) && vel > 0.8) {
    const c = Math.cos((rumbo - u.az) * RAD);
    if (Math.abs(c) > 0.5) S.dir = c > 0 ? 1 : -1;
  } else {
    const dp = u.prog - S.hist[0].p;
    if (Math.abs(dp) > 8) S.dir = dp > 0 ? 1 : -1;
  }
  if (antes !== S.dir) S.hist = [{ t: u.t, p: u.prog }];
}

function dibujarYo() {
  const { lat, lon, prec, rumbo, vel } = S.pos;
  const giro = rumbo != null && !isNaN(rumbo) && vel > 0.8 ? rumbo : (S.u.az + (S.dir < 0 ? 180 : 0));
  if (!S.mkYo) {
    S.circPrec = L.circle([lat, lon], { radius: prec, color: '#1976d2', weight: 1, fillOpacity: .1, interactive: false }).addTo(G.yo);
    S.mkYo = L.marker([lat, lon], { icon: iconoUsuario(), interactive: false, zIndexOffset: 1000 }).addTo(G.yo);
  }
  S.circPrec.setLatLng([lat, lon]).setRadius(Math.min(prec, 200));
  S.mkYo.setLatLng([lat, lon]);
  const svg = S.mkYo.getElement()?.querySelector('svg');
  if (svg) svg.style.transform = `rotate(${giro}deg)`;
}

function quitarYo() { G.yo.clearLayers(); S.mkYo = null; S.circPrec = null; }

function pintarBarra() {
  const u = S.u;
  $('#etq-prog').textContent = S.pos?.simulada ? 'Simulación' : 'Estás en';
  $('#prog').classList.add('vivo');
  $('#prog').textContent = fmtProg(u.prog);
  // el lado se expresa respecto de hacia dónde avanzas, no del sentido de la progresiva
  $('#lado').textContent = fmtLado(u.off * S.dir);
  $('#sentido').innerHTML = S.dir > 0 ? `▲ hacia ${fmtProg(S.eje.fin)} <span>⇅</span>` : `▼ hacia ${fmtProg(S.eje.inicio)} <span>⇅</span>`;
  $('#proximo').innerHTML = textoProximo(u);
}

$('#sentido').onclick = () => {
  S.dir = -S.dir;
  S.hist = S.u ? [{ t: Date.now(), p: S.u.prog }] : [];
  S.avisados.clear();
  if (S.u && S.enVia) { pintarBarra(); dibujarYo(); }
  mostrarAviso(`Sentido de avance: hacia ${fmtProg(S.dir > 0 ? S.eje.fin : S.eje.inicio)}`, 'info');
};

function elementosAvisables() {
  const t = S.ajustes.tipos;
  return S.elementos.filter((e) => !t || t.includes(e.tipo));
}

function textoProximo(u) {
  const lr = (e) => (e.lado ? ` · <b>a tu ${ladoRel(e.lado)}</b>` : '');
  const dentro = S.elementos.filter((e) => e.fin != null && u.prog >= Math.min(e.ini, e.fin) && u.prog <= Math.max(e.ini, e.fin));
  let prox = null, dmin = Infinity;
  for (const e of elementosAvisables()) {
    const pe = S.dir > 0 ? Math.min(e.ini, e.fin ?? e.ini) : Math.max(e.ini, e.fin ?? e.ini);
    const d = (pe - u.prog) * S.dir;
    if (d > 1 && d < dmin) { dmin = d; prox = e; }
  }
  const partes = [];
  if (dentro.length) partes.push('Sobre: ' + dentro.slice(0, 2).map((e) => `${esc(descSinLado(e.desc))}${lr(e)}`).join(', '));
  if (prox) partes.push(`Sigue: <b>${esc(prox.codigo)}</b> ${esc(descSinLado(prox.desc))} · ${Math.round(dmin)} m${lr(prox)}`);
  return partes.join('<br>') || 'Sin elementos adelante';
}

function avisos(u) {
  const aj = S.ajustes;
  if (u.dist > aj.fueraEje) {
    if (!S.avisoFuera && ++S.fueraCont >= 3) { S.avisoFuera = true; alerta(`Estás a ${Math.round(u.dist)} m del eje`, `Atención. Estás a ${Math.round(u.dist)} metros del eje`); }
    return;
  }
  S.fueraCont = 0; S.avisoFuera = false;

  if (aj.cada > 0) {
    const tramo = Math.floor(u.prog / aj.cada);
    if (S.ultTramo != null && tramo !== S.ultTramo) {
      const hito = Math.max(tramo, S.ultTramo) * aj.cada;
      alerta(`Km ${fmtProg(hito)}`, vozProg(hito), 'info');
    }
    S.ultTramo = tramo;
  }
  for (const e of elementosAvisables()) {
    const a = Math.min(e.ini, e.fin ?? e.ini), b = Math.max(e.ini, e.fin ?? e.ini);
    const pe = S.dir > 0 ? a : b, d = (pe - u.prog) * S.dir;
    const dentro = u.prog >= a - 5 && u.prog <= b + 5;
    if (!S.avisados.has(e.codigo) && (d > 0 && d <= aj.distAviso || dentro)) {
      S.avisados.add(e.codigo);
      const lado = ladoRel(e.lado), desc = descSinLado(e.desc);
      alerta(`${dentro ? 'Estás en' : `En ${Math.round(d)} m:`} ${e.codigo} · ${desc}${lado ? ` · a tu ${lado}` : ''}`,
        `${dentro ? 'Estás en' : `En ${redondear(d)} metros,`} ${vozTexto(desc)}${lado ? `, a tu ${lado}` : ''}`);
    } else if (S.avisados.has(e.codigo) && !dentro && Math.min(Math.abs(u.prog - a), Math.abs(u.prog - b)) > aj.distAviso * 2) {
      S.avisados.delete(e.codigo);
    }
  }
}

const redondear = (d) => (d > 20 ? Math.round(d / 10) * 10 : Math.round(d));
function vozProg(p) {
  const km = Math.floor(Math.round(p) / 1000), m = Math.round(p) % 1000;
  return `Kilómetro ${km}${m ? ' más ' + m : ''}`;
}
const vozTexto = (t) => String(t).replace(/Ø\s*(\d+)"?/g, 'de $1 pulgadas').replace(/\bTMC\b/g, 'T M C').replace(/\bL=\s*(\d+) m/g, 'de $1 metros').replace(/L≈\s*(\d+) m/g, 'de $1 metros');

let audio = null;
function alerta(texto, voz, clase = '') {
  mostrarAviso(texto, clase);
  if (S.ajustes.vibrar && navigator.vibrate) navigator.vibrate(clase === 'info' ? 120 : [200, 100, 200]);
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = clase === 'info' ? 660 : 880; g.gain.value = .15;
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .15);
  } catch { /* sin audio */ }
  if (S.ajustes.voz && 'speechSynthesis' in window && voz) {
    const u = new SpeechSynthesisUtterance(voz);
    u.lang = 'es-PE';
    const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith('es'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
}

let avisoT = null;
function mostrarAviso(texto, clase = '') {
  const a = $('#aviso');
  a.textContent = texto; a.className = clase;
  clearTimeout(avisoT);
  avisoT = setTimeout(() => a.classList.add('oculto'), clase === 'info' ? 3000 : 6000);
}

// Los navegadores solo dejan hablar y sonar después del primer toque en la pantalla
function desbloquearAudio() {
  if (S.audioListo) return;
  S.audioListo = true;
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* sin audio */ }
  if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  pedirPantalla();
  pintarEstado();
}
document.addEventListener('pointerdown', desbloquearAudio, { capture: true });

// ---- GPS: arranca solo al abrir la app ----
function iniciarGPS() {
  if (S.watch != null || S.sim || S.pausado || !S.eje) return;
  if (!('geolocation' in navigator)) { S.gpsError = 'Este teléfono no permite usar el GPS en el navegador'; mostrarCentro(); return; }
  S.watch = navigator.geolocation.watchPosition(
    (p) => alPosicion(p.coords.latitude, p.coords.longitude, p.coords.accuracy, false, p.coords.heading, p.coords.speed),
    (err) => {
      S.gpsError = err.code === 1 ? 'Ubicación bloqueada: permítela para esta app en los ajustes del navegador' : 'Buscando señal GPS…';
      if (!S.enVia) mostrarCentro();
      pintarEstado();
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  pedirPantalla();
}

function detenerGPS() {
  if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
  S.watch = null;
}

function salirDeVia() {
  S.enVia = false; S.pos = null; S.u = null; S.hist = []; S.ultTramo = null; S.avisados.clear();
  document.body.classList.remove('recorrido');
  quitarYo();
}

function pausarGPS(pausar) {
  S.pausado = pausar;
  if (pausar) {
    detenerGPS(); detenerSim(false); salirDeVia(); soltarPantalla();
    mostrarAviso('GPS en pausa', 'info');
  } else {
    iniciarGPS();
    mostrarAviso('GPS activo', 'info');
  }
  mostrarCentro(); pintarEstado();
}

async function pedirPantalla() {
  if (!S.ajustes.pantalla || !('wakeLock' in navigator) || S.wake || S.pausado) return;
  try { S.wake = await navigator.wakeLock.request('screen'); S.wake.addEventListener('release', () => { S.wake = null; }); } catch { /* no disponible */ }
}
function soltarPantalla() { if (S.wake) S.wake.release().catch(() => {}); S.wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirPantalla(); });

function setSeguir(v) {
  S.seguir = v;
  $('#btn-centrar').classList.toggle('activo', v && S.enVia);
}

// ---- modo demostración: recorre el eje sin salir de la oficina ----
function iniciarSim(desde, kmh, sentido) {
  detenerSim(false); detenerGPS(); salirDeVia();
  S.pausado = false;
  S.sim = { prog: desde, v: kmh / 3.6, dir: sentido };
  S.dir = sentido;
  S.sim.timer = setInterval(() => {
    const s = S.sim;
    s.prog = Math.min(Math.max(s.prog + s.v * s.dir, S.eje.inicio), S.eje.fin);
    const [lat, lon] = S.eje.puntoLatLon(s.prog, 2 * Math.sin(s.prog / 37));
    const az = S.eje.ubicar(...S.eje.punto(s.prog)).az;
    alPosicion(lat, lon, 5, true, (az + (s.dir < 0 ? 180 : 0)) % 360, s.v);
    if (s.prog <= S.eje.inicio || s.prog >= S.eje.fin) detenerSim();
  }, 1000);
  pintarEstado();
}
// al terminar la simulación vuelve el GPS real
function detenerSim(volverGPS = true) {
  if (!S.sim) return;
  clearInterval(S.sim.timer); S.sim = null;
  salirDeVia(); mostrarCentro(); pintarEstado();
  if (volverGPS) iniciarGPS();
}

// ================= estado / sincronización =================
function pintarEstado(extra) {
  const p = proyActual(), partes = [];
  if (p) partes.push(esc(p.nombre));
  if (S.sim) partes.push('<span class="sim">SIMULACIÓN</span>');
  if (S.pausado) partes.push('<button class="chip" data-a="reanudar">⏸ GPS en pausa · Reanudar</button>');
  else if (S.pos && !S.pos.simulada) partes.push(S.pos.prec > 30 ? `<span class="mal">GPS débil ±${Math.round(S.pos.prec)} m</span>` : `GPS ±${Math.round(S.pos.prec)} m`);
  else if (S.gpsError && !S.sim) partes.push(`<span class="mal">${esc(S.gpsError.split(':')[0])}</span>`);
  if (S.ajustes.voz && !S.audioListo && p) partes.push('<button class="chip">🔇 Toca la pantalla para activar la voz</button>');
  if (!navigator.onLine) partes.push('<span class="mal">Sin internet</span>');
  const pend = S.obs.filter((o) => o.sync !== 'ok').length;
  if (pend && p?.url) partes.push(`<span class="mal">${pend} por enviar</span>`);
  if (extra) partes.push(`<span class="mal">${esc(extra)}</span>`);
  $('#estado').innerHTML = partes.join(' · ');
}
$('#estado').addEventListener('click', (e) => { if (e.target.closest('[data-a="reanudar"]')) pausarGPS(false); });
window.addEventListener('online', () => { pintarEstado(); sincronizar(); });
window.addEventListener('offline', () => pintarEstado());

function aplicarDatos(datos) {
  S.datos = datos;
  const c = datos.config || {};
  const zona = +c.ZONA_UTM || 17, sur = String(c.HEMISFERIO || 'S').toUpperCase().startsWith('S');
  S.eje = datos.eje?.length > 1 ? new Eje(datos.eje, zona, sur) : null;
  S.tipos = {};
  for (const t of datos.tipos || []) S.tipos[t.TIPO] = [t.NOMBRE, t.COLOR || '#757575'];
  S.elementos = (datos.elementos || []).filter((e) => e.CODIGO && e.PROG_INI !== '' && e.PROG_INI != null).map((e) => ({
    codigo: String(e.CODIGO), tipo: String(e.TIPO || 'OTR'), ini: +e.PROG_INI,
    fin: e.PROG_FIN === '' || e.PROG_FIN == null ? null : +e.PROG_FIN,
    lado: String(e.LADO || '').toUpperCase(), desc: String(e.DESCRIPCION || nombreTipo(e.TIPO)),
    estado: e.ESTADO, obs: e.OBS,
  })).sort((a, b) => a.ini - b.ini);
  dibujarProyecto();
  if (S.eje && S.encuadrar && !S.enVia) mapa.fitBounds(L.latLngBounds(S.eje.latlngs()), { padding: [20, 20] });
  S.encuadrar = false;
  mostrarCentro();
}

async function abrirProyecto(id) {
  detenerSim(false); detenerGPS(); salirDeVia();
  S.actual = id; await kv.set('actual', id);
  const p = proyActual();
  S.obs = await obsDB.todas(id);
  S.encuadrar = true;
  const cache = await kv.get('datos:' + id);
  if (cache) aplicarDatos(cache);
  pintarEstado();
  if (p.url) await actualizarDatos(!cache);
  iniciarGPS();
}

async function actualizarDatos(forzar = false, avisar = false) {
  const p = proyActual();
  if (!p?.url || !navigator.onLine) { if (avisar) mostrarAviso(p?.url ? 'Sin internet: se usan los datos guardados' : 'Proyecto de archivo: no se actualiza desde internet', 'info'); return; }
  try {
    const A = api(p);
    const v = await A.version();
    if (forzar || v.version !== S.datos?.version) {
      const d = await A.proyecto();
      await kv.set('datos:' + p.id, d);
      const habia = !!S.datos;
      aplicarDatos(d);
      if (habia) mostrarAviso('Se actualizaron el eje y los elementos del proyecto', 'info');
    } else if (avisar) mostrarAviso('Los datos ya están al día', 'info');
    await sincronizar();
  } catch (e) {
    pintarEstado('No se pudo conectar');
    if (avisar || !S.datos) mostrarAviso('No se pudo conectar con la hoja del proyecto: ' + e.message);
  }
}
setInterval(() => { if (document.visibilityState === 'visible') actualizarDatos(); }, 5 * 60 * 1000);

let sincronizando = false;
async function sincronizar() {
  const p = proyActual();
  if (!p?.url || !navigator.onLine || sincronizando) return;
  sincronizando = true;
  try {
    const A = api(p);
    for (const o of S.obs.filter((x) => x.sync !== 'ok')) {
      const fotos = (o.fotos || []).filter((f) => f.datos && !f.url).map((f) => ({ id: f.id, nombre: f.nombre, datos: f.datos.split(',')[1] }));
      const { fotos: _, ...resto } = o;
      const r = await A.enviar('obs_guardar', { obs: { ...resto, fotos: undefined }, fotos });
      for (const f of o.fotos || []) if (r.fotos?.[f.id]) { f.url = r.fotos[f.id]; delete f.datos; }
      o.sync = 'ok';
      await obsDB.guardar(o);
    }
    const { obs } = await A.observaciones();
    for (const r of obs || []) {
      const l = S.obs.find((x) => x.id === r.id);
      if (l && l.sync !== 'ok') continue;
      if (!l || (r.actualizado || '') > (l.actualizado || '')) {
        const fotos = (r.fotos || []).map((url, i) => l?.fotos?.find((f) => f.url === url) || { id: r.id + '-' + i, url });
        const n = { ...r, fotos, proyecto: p.id, sync: 'ok' };
        await obsDB.guardar(n);
      }
    }
    S.obs = await obsDB.todas(p.id);
    dibujarObs();
  } catch (e) {
    pintarEstado('Envío pendiente');
  } finally { sincronizando = false; pintarEstado(); }
}

// ================= hoja inferior (pantallas) =================
function hoja(titulo, html, alCerrar) {
  $('#hoja-titulo').textContent = titulo;
  const c = $('#hoja-cuerpo');
  c.innerHTML = html; c.scrollTop = 0;
  $('#hoja').classList.remove('oculto'); $('#velo').classList.remove('oculto');
  hoja.alCerrar = alCerrar;
  return c;
}
function cerrarHoja() {
  $('#hoja').classList.add('oculto'); $('#velo').classList.add('oculto');
  if (hoja.alCerrar) { const f = hoja.alCerrar; hoja.alCerrar = null; f(); }
}
$('#hoja-cerrar').onclick = cerrarHoja;
$('#velo').onclick = cerrarHoja;

function menu() {
  const pend = proyActual()?.url ? S.obs.filter((o) => o.sync !== 'ok').length : 0;
  const c = hoja('Menú', `<div class="lista-menu">
    <button data-a="buscar"><span class="ic">🔎</span>Ir a una progresiva</button>
    <button data-a="elementos"><span class="ic">🧱</span>Elementos de obra<span class="nota">${S.elementos.length}</span></button>
    <button data-a="obs"><span class="ic">📝</span>Observaciones<span class="nota">${S.obs.filter((o) => o.estado !== 'ANULADA').length}${pend ? ` · ${pend} por enviar` : ''}</span></button>
    <button data-a="gps"><span class="ic">${S.pausado ? '▶️' : '⏸️'}</span>${S.pausado ? 'Reanudar GPS' : 'Pausar GPS (ahorrar batería)'}</button>
    <button data-a="proyectos"><span class="ic">📁</span>Proyectos<span class="nota">${esc(proyActual()?.nombre || 'ninguno')}</span></button>
    <button data-a="actualizar"><span class="ic">🔄</span>Actualizar datos ahora</button>
    <button data-a="ajustes"><span class="ic">⚙️</span>Ajustes y avisos</button>
    <button data-a="demo"><span class="ic">🚶</span>Modo demostración${S.sim ? '<span class="nota">en curso</span>' : ''}</button>
    <button data-a="ayuda"><span class="ic">❓</span>Cómo se usa</button>
  </div><p class="ayuda" style="text-align:center;margin-top:14px">Recorrido de Obra v${VERSION_APP}</p>`);
  c.querySelectorAll('button').forEach((b) => b.onclick = () => ({
    buscar: pantallaBuscar, elementos: pantallaElementos, obs: pantallaObs, proyectos: pantallaProyectos,
    gps: () => { cerrarHoja(); pausarGPS(!S.pausado); },
    actualizar: () => { cerrarHoja(); actualizarDatos(true, true); }, ajustes: pantallaAjustes, demo: pantallaDemo, ayuda: pantallaAyuda,
  })[b.dataset.a]());
}

function pantallaBuscar() {
  const c = hoja('Ir a una progresiva', `
    <label class="campo" for="b-prog">Progresiva</label>
    <input id="b-prog" type="text" inputmode="decimal" placeholder="Ej. 12+500">
    <p class="ayuda">Escribe como en los planos: 12+500, o en metros: 12500.</p>
    <div class="botones"><button class="btn" id="b-cancel">Cancelar</button><button class="btn primario" id="b-ir">Ir</button></div>`);
  const inp = c.querySelector('#b-prog'); inp.focus();
  const ir = () => {
    const p = parseProg(inp.value);
    if (p == null || !S.eje) return mostrarAviso('Escribe una progresiva válida, por ejemplo 12+500');
    if (p < S.eje.inicio || p > S.eje.fin) return mostrarAviso(`La vía va de ${fmtProg(S.eje.inicio)} a ${fmtProg(S.eje.fin)}`);
    cerrarHoja(); setSeguir(false);
    const pt = S.eje.puntoLatLon(p);
    mapa.setView(pt, 17);
    L.popup().setLatLng(pt).setContent(`<h3>Km ${fmtProg(p)}</h3>`).openOn(mapa);
  };
  c.querySelector('#b-ir').onclick = ir;
  inp.onkeydown = (e) => { if (e.key === 'Enter') ir(); };
  c.querySelector('#b-cancel').onclick = cerrarHoja;
}

function pantallaElementos() {
  const tipos = [...new Set(S.elementos.map((e) => e.tipo))];
  let filtro = null;
  const c = hoja('Elementos de obra', `
    <input id="e-txt" type="search" placeholder="Buscar código o descripción">
    <div class="chips" id="e-tipos" style="margin:10px 0"><button data-t="" class="sel">Todos</button>${tipos.map((t) => `<button data-t="${esc(t)}">${miniTipo(t, colorTipo(t), 22)}${esc(nombreTipo(t))}</button>`).join('')}</div>
    <div id="e-lista"></div>`);
  const pintar = () => {
    const q = c.querySelector('#e-txt').value.trim().toLowerCase();
    const lst = S.elementos.filter((e) => (!filtro || e.tipo === filtro) && (!q || (e.codigo + ' ' + e.desc).toLowerCase().includes(q)));
    c.querySelector('#e-lista').innerHTML = lst.slice(0, 400).map((e) => `<button class="item" data-i="${S.elementos.indexOf(e)}">
      ${miniTipo(e.tipo, colorTipo(e.tipo))}
      <span><span class="t">${esc(e.codigo)}</span><br><span class="s">${esc(e.desc)}${e.obs ? ' · ⚠' : ''}</span></span>
      <span class="der">${fmtProg(e.ini)}${e.fin != null ? '<br><span class="s">a ' + fmtProg(e.fin) + '</span>' : ''}<br><span class="etq">${esc(e.estado || '')}</span></span></button>`).join('')
      || '<p class="ayuda">No hay elementos con ese filtro.</p>';
    c.querySelectorAll('.item').forEach((b) => b.onclick = () => {
      const e = S.elementos[+b.dataset.i];
      cerrarHoja(); setSeguir(false);
      mapa.setView(e.capa.getLatLng(), 17);
      setTimeout(() => e.capa?.openPopup(), 300);
    });
  };
  c.querySelector('#e-txt').oninput = pintar;
  c.querySelectorAll('#e-tipos button').forEach((b) => b.onclick = () => {
    filtro = b.dataset.t || null;
    c.querySelectorAll('#e-tipos button').forEach((x) => x.classList.toggle('sel', x === b));
    pintar();
  });
  pintar();
}

function pantallaObs() {
  const lst = [...S.obs].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const c = hoja('Observaciones', `
    <div class="fila"><button class="btn primario crece" id="o-nueva">＋ Nueva observación</button><button class="btn" id="o-csv">Exportar</button></div>
    <div id="o-lista" style="margin-top:8px">${lst.map((o) => `<button class="item" data-id="${esc(o.id)}">
      <span><span class="t">${esc(o.categoria)} · Km ${fmtProg(o.prog)}</span><br>
      <span class="s">${esc((o.texto || '').slice(0, 80))}</span><br><span class="s">${esc(o.usuario)} · ${new Date(o.fecha).toLocaleDateString('es-PE')}${o.fotos?.length ? ` · 📷 ${o.fotos.length}` : ''}</span></span>
      <span class="der"><span class="etq ${o.estado === 'LEVANTADA' ? 'ok' : o.estado === 'ANULADA' ? '' : 'mal'}">${esc(o.estado)}</span><br>
      ${o.sync !== 'ok' && proyActual()?.url ? '<span class="etq pend">por enviar</span>' : ''}</span></button>`).join('') || '<p class="ayuda">Todavía no hay observaciones.</p>'}</div>`);
  c.querySelector('#o-nueva').onclick = () => abrirObs();
  c.querySelector('#o-csv').onclick = exportarCSV;
  c.querySelectorAll('.item').forEach((b) => b.onclick = () => abrirObs(b.dataset.id));
}

function exportarCSV() {
  const cols = ['fecha', 'usuario', 'prog', 'off', 'lat', 'lon', 'categoria', 'elemento', 'texto', 'estado'];
  const filas = [['FECHA', 'USUARIO', 'PROGRESIVA', 'LADO', 'LAT', 'LON', 'CATEGORIA', 'ELEMENTO', 'DESCRIPCION', 'ESTADO', 'FOTOS'].join(';')];
  for (const o of S.obs) {
    const v = cols.map((k) => k === 'prog' ? fmtProg(o.prog, 1) : k === 'off' ? fmtLadoProg(o.off) : o[k] ?? '');
    v.push((o.fotos || []).map((f) => f.url || '(en el teléfono)').join(' '));
    filas.push(v.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';'));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv' }));
  a.download = `observaciones_${(proyActual()?.nombre || 'obra').replace(/\W+/g, '_')}.csv`;
  a.click();
}

// Texto del sello de las fotos: progresiva, lado, coordenadas, fecha, usuario y obra
function lineasSello() {
  const lineas = [];
  if (S.pos && Date.now() - S.pos.t < 20000 && S.u) {
    const [E, N] = latLonAUtm(S.pos.lat, S.pos.lon, S.eje.zona, S.eje.sur);
    lineas.push(S.u.dist <= EN_VIA_M ? `Km ${fmtProg(S.u.prog, 1)} · ${fmtLadoProg(S.u.off)}` : `Fuera de la vía · ${(S.u.dist / 1000).toFixed(1)} km del eje`);
    lineas.push(`${S.pos.lat.toFixed(6)}, ${S.pos.lon.toFixed(6)} · ±${Math.round(S.pos.prec)} m${S.pos.simulada ? ' (simulación)' : ''}`);
    lineas.push(`E ${E.toFixed(1)}  N ${N.toFixed(1)} · UTM ${S.eje.zona}${S.eje.sur ? 'S' : 'N'} WGS84`);
  } else lineas.push('Sin señal GPS');
  lineas.push(`${new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${S.ajustes.nombre}`);
  if (proyActual()) lineas.push(proyActual().nombre);
  return lineas;
}

// ---- formulario de observación ----
async function abrirObs(id = null, pre = {}) {
  if (!S.eje) return mostrarAviso('Primero agrega un proyecto');
  if (!S.ajustes.nombre) return pantallaNombre(() => abrirObs(id, pre));
  let o = id ? structuredClone(S.obs.find((x) => x.id === id)) : null;
  if (!o) {
    o = { id: uid(), proyecto: S.actual, fecha: new Date().toISOString(), usuario: S.ajustes.nombre, categoria: 'Calidad', elemento: pre.elemento || '', texto: '', estado: 'ABIERTA', fotos: [] };
    if (pre.prog != null) ponerProg(o, pre.prog, pre.off || 0, pre.fuente);
    else if (S.pos && Date.now() - S.pos.t < 30000 && S.enVia) {
      o.lat = S.pos.lat; o.lon = S.pos.lon; o.prec = Math.round(S.pos.prec);
      o.prog = S.u.prog; o.off = S.u.off; o.fuente = S.pos.simulada ? 'Simulación' : 'GPS';
    } else {
      const c = mapa.getCenter(); const u = ubicarLatLon(c.lat, c.lng);
      ponerProg(o, u.prog, u.dist < 100 ? u.off : 0, 'Centro del mapa');
    }
    if (!o.elemento) {
      // si hay un elemento a menos de 20 m, se propone como relacionado
      const cerca = S.elementos.map((e) => [e, e.fin != null && o.prog >= Math.min(e.ini, e.fin) && o.prog <= Math.max(e.ini, e.fin) ? 0 : Math.abs(e.ini - o.prog)])
        .filter(([, d]) => d < 20).sort((a, b) => a[1] - b[1])[0];
      if (cerca) o.elemento = cerca[0].codigo;
    }
  }
  const nuevo = !S.obs.some((x) => x.id === o.id);
  const cercanos = S.elementos.filter((e) => Math.abs(e.ini - o.prog) < 250 || (e.fin != null && o.prog >= Math.min(e.ini, e.fin) && o.prog <= Math.max(e.ini, e.fin)));
  if (o.elemento && !cercanos.some((e) => e.codigo === o.elemento)) { const e = S.elementos.find((x) => x.codigo === o.elemento); if (e) cercanos.unshift(e); }
  const c = hoja(nuevo ? 'Nueva observación' : 'Observación', `
    <div class="caja"><div class="fila"><div class="crece"><b id="f-prog">Km ${fmtProg(o.prog, 1)}</b> <span id="f-lado">${fmtLadoProg(o.off)}</span><br>
      <span class="ayuda" id="f-fuente">Ubicación: ${esc(o.fuente || '')}${o.prec ? ` (±${o.prec} m)` : ''}</span></div>
      <button class="btn" id="f-cambiar">Cambiar</button></div>
      <div id="f-manual" class="oculto">
        <label class="campo" for="f-pin">Progresiva</label><input id="f-pin" type="text" inputmode="decimal" value="${fmtProg(o.prog, 1)}">
        <p class="ayuda">Lado según los planos (sentido de la progresiva):</p>
        <div class="chips" id="f-lados">${[['LI', 'Izquierdo (LI)'], ['EJE', 'Eje'], ['LD', 'Derecho (LD)']].map(([k, t]) => `<button data-l="${k}" class="${(o.off < -1 ? 'LI' : o.off > 1 ? 'LD' : 'EJE') === k ? 'sel' : ''}">${t}</button>`).join('')}</div>
        <div class="fila" style="margin-top:8px"><button class="btn crece" id="f-gps">📍 Mi posición GPS</button><button class="btn crece" id="f-centro">✛ Centro del mapa</button></div>
        <button class="btn primario" id="f-aplicar" style="width:100%;margin-top:8px">Aplicar progresiva</button>
      </div></div>
    <label class="campo">Fotos</label>
    <div class="fila"><button class="btn primario crece" id="f-cam">📷 Cámara con sello</button>
      <label class="btn crece" style="display:flex;align-items:center;justify-content:center">🖼 Galería<input id="f-gal" type="file" accept="image/*" multiple hidden></label></div>
    <p class="ayuda">La cámara de la app imprime en la foto la progresiva, el lado, las coordenadas, la fecha y tu nombre. En «Galería» puedes adjuntar fotos de TimeStampCam u otra app.</p>
    <div class="fotos" id="f-fotos"></div>
    <div id="f-exif"></div>
    <label class="campo">Tipo de observación</label>
    <div class="chips" id="f-cat">${CATEGORIAS.map((k) => `<button class="${k === o.categoria ? 'sel' : ''}">${k}</button>`).join('')}</div>
    <label class="campo" for="f-elem">Elemento relacionado</label>
    <select id="f-elem"><option value="">— Ninguno —</option>${cercanos.map((e) => `<option value="${esc(e.codigo)}" ${e.codigo === o.elemento ? 'selected' : ''}>${esc(e.codigo)} · ${esc(e.desc)} (${fmtProg(e.ini)})</option>`).join('')}</select>
    <label class="campo" for="f-txt">Descripción</label>
    <textarea id="f-txt" placeholder="¿Qué observaste?">${esc(o.texto)}</textarea>
    <label class="campo">Estado</label>
    <div class="chips" id="f-est">${ESTADOS_OBS.map((k) => `<button class="${k === o.estado ? 'sel' : ''}">${k}</button>`).join('')}</div>
    <p class="ayuda">${nuevo ? '' : `Registrada por ${esc(o.usuario)} el ${new Date(o.fecha).toLocaleString('es-PE')}${o.actualizadoPor ? ` · última edición: ${esc(o.actualizadoPor)}` : ''}`}</p>
    <div class="botones"><button class="btn" id="f-cancel">Cancelar</button><button class="btn primario" id="f-guardar">Guardar</button></div>
    ${!nuevo && o.sync !== 'ok' ? '<button class="btn peligro" id="f-borrar" style="width:100%;margin-top:8px">Borrar (aún no enviada)</button>' : ''}`);

  const pintarUbic = () => {
    c.querySelector('#f-prog').textContent = `Km ${fmtProg(o.prog, 1)}`;
    c.querySelector('#f-lado').textContent = fmtLadoProg(o.off);
    c.querySelector('#f-fuente').textContent = `Ubicación: ${o.fuente || ''}${o.prec ? ` (±${o.prec} m)` : ''}`;
  };
  const pintarFotos = () => {
    c.querySelector('#f-fotos').innerHTML = o.fotos.map((f, i) => `<div>${f.mini ? `<img src="${f.mini}" alt="">` : `<a href="${esc(f.url)}" target="_blank" rel="noopener">Ver foto ${i + 1}</a>`}${!f.url ? `<button data-i="${i}" aria-label="Quitar">✕</button>` : ''}</div>`).join('');
    c.querySelectorAll('#f-fotos button').forEach((b) => b.onclick = () => { o.fotos.splice(+b.dataset.i, 1); pintarFotos(); });
    // fotos de galería con GPS en sus datos: se ofrece usar esa ubicación
    const conGps = o.fotos.find((f) => f.exif?.lat != null && !f.url);
    const ex = c.querySelector('#f-exif');
    ex.innerHTML = conGps && o.fuente !== 'Foto' ? `<button class="btn" style="width:100%;margin-top:8px">📍 Usar la ubicación guardada en la foto</button>` : '';
    if (ex.firstChild) ex.firstChild.onclick = () => {
      const u = ubicarLatLon(conGps.exif.lat, conGps.exif.lon);
      o.lat = conGps.exif.lat; o.lon = conGps.exif.lon; o.prog = u.prog; o.off = u.off; o.fuente = 'Foto'; delete o.prec;
      pintarUbic(); pintarFotos();
    };
  };
  pintarFotos();

  c.querySelector('#f-cambiar').onclick = () => c.querySelector('#f-manual').classList.toggle('oculto');
  let ladoSel = o.off < -1 ? 'LI' : o.off > 1 ? 'LD' : 'EJE';
  c.querySelectorAll('#f-lados button').forEach((b) => b.onclick = () => { ladoSel = b.dataset.l; c.querySelectorAll('#f-lados button').forEach((x) => x.classList.toggle('sel', x === b)); });
  c.querySelector('#f-aplicar').onclick = () => {
    const p = parseProg(c.querySelector('#f-pin').value);
    if (p == null) return mostrarAviso('Progresiva no válida');
    ponerProg(o, p, offLado(ladoSel), 'Escrita a mano');
    pintarUbic(); c.querySelector('#f-manual').classList.add('oculto');
  };
  c.querySelector('#f-gps').onclick = () => {
    navigator.geolocation.getCurrentPosition((p) => {
      o.lat = p.coords.latitude; o.lon = p.coords.longitude; o.prec = Math.round(p.coords.accuracy);
      const u = ubicarLatLon(o.lat, o.lon); o.prog = u.prog; o.off = u.off; o.fuente = 'GPS';
      pintarUbic(); c.querySelector('#f-manual').classList.add('oculto');
    }, () => mostrarAviso('No se pudo obtener la posición GPS'), { enableHighAccuracy: true, timeout: 20000 });
  };
  c.querySelector('#f-centro').onclick = () => {
    const m = mapa.getCenter(), u = ubicarLatLon(m.lat, m.lng);
    o.lat = m.lat; o.lon = m.lng; o.prog = u.prog; o.off = u.off; o.fuente = 'Centro del mapa'; delete o.prec;
    pintarUbic(); c.querySelector('#f-manual').classList.add('oculto');
  };
  const chips = (sel, campo) => c.querySelectorAll(sel + ' button').forEach((b) => b.onclick = () => {
    o[campo] = b.textContent; c.querySelectorAll(sel + ' button').forEach((x) => x.classList.toggle('sel', x === b));
  });
  chips('#f-cat', 'categoria'); chips('#f-est', 'estado');

  const camara = () => abrirCamara({
    lineas: lineasSello,
    alFoto: (f) => {
      const gps = S.pos && S.u ? { lat: S.pos.lat, lon: S.pos.lon, prec: Math.round(S.pos.prec), prog: S.u.prog, off: S.u.off } : null;
      o.fotos.push({ id: uid(), nombre: `foto_${gps ? fmtProg(gps.prog).replace('+', '-') : 'sin-gps'}.jpg`, ...f, gps, sello: true });
    },
    alCerrar: pintarFotos,
  });
  c.querySelector('#f-cam').onclick = camara;
  c.querySelector('#f-gal').onchange = async (e) => {
    for (const file of e.target.files) {
      mostrarAviso('Procesando foto…', 'info');
      const exif = await leerExif(file);
      const [datos, mini] = await Promise.all([reducir(file), reducir(file, 320, .7)]);
      o.fotos.push({ id: uid(), nombre: file.name || 'foto.jpg', datos, mini, exif });
    }
    e.target.value = '';
    $('#aviso').classList.add('oculto');
    pintarFotos();
  };
  c.querySelector('#f-cancel').onclick = cerrarHoja;
  c.querySelector('#f-borrar')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta observación del teléfono?')) return;
    await obsDB.borrar(o.id); S.obs = S.obs.filter((x) => x.id !== o.id); dibujarObs(); cerrarHoja(); pintarEstado();
  });
  c.querySelector('#f-guardar').onclick = async () => {
    o.texto = c.querySelector('#f-txt').value.trim();
    o.elemento = c.querySelector('#f-elem').value;
    if (!o.texto && !o.fotos.length) return mostrarAviso('Escribe una descripción o agrega una foto');
    o.actualizado = new Date().toISOString();
    if (!nuevo) o.actualizadoPor = S.ajustes.nombre;
    o.sync = 'pendiente';
    await obsDB.guardar(o);
    S.obs = await obsDB.todas(S.actual);
    dibujarObs(); cerrarHoja();
    const p = proyActual();
    mostrarAviso(p?.url ? (navigator.onLine ? 'Observación guardada. Enviando…' : 'Guardada en el teléfono. Se enviará cuando haya señal.') : 'Observación guardada en el teléfono', 'info');
    await sincronizar();
  };
  if (pre.camara) camara();
}

function ponerProg(o, prog, off, fuente) {
  const [lat, lon] = S.eje.puntoLatLon(prog, off);
  Object.assign(o, { prog, off, lat, lon, fuente }); delete o.prec;
}

// ---- proyectos ----
function pantallaProyectos() {
  const c = hoja('Proyectos', `
    <div id="p-lista">${S.proyectos.map((p) => `<div class="item"><span class="punto" style="background:${p.id === S.actual ? '#2e7d32' : '#c5ccd3'}"></span>
      <span class="crece"><span class="t">${esc(p.nombre)}</span><br><span class="s">${p.url ? 'Conectado a su hoja de Google' : 'Abierto desde archivo (solo en este teléfono)'}</span></span>
      <span class="der">${p.id === S.actual ? '<span class="etq ok">en uso</span>' : `<button class="btn" data-usar="${p.id}">Usar</button>`}<br>
      <button class="btn peligro" data-quitar="${p.id}" style="margin-top:6px;min-height:36px">Quitar</button></span></div>`).join('') || '<p class="ayuda">Aún no tienes proyectos.</p>'}</div>
    <label class="campo" for="p-enlace">Agregar proyecto con su enlace</label>
    <textarea id="p-enlace" placeholder="Pega aquí el enlace que te envió el responsable del proyecto" style="min-height:70px"></textarea>
    <button class="btn primario" id="p-agregar" style="width:100%;margin-top:8px">Agregar</button>
    <label class="btn" style="display:flex;align-items:center;justify-content:center;margin-top:8px">Abrir archivo de proyecto (.json)<input id="p-archivo" type="file" accept=".json,application/json" hidden></label>
    <p class="ayuda">Cada obra es un proyecto. Puedes tener varios y cambiar entre ellos.</p>`);
  c.querySelectorAll('[data-usar]').forEach((b) => b.onclick = async () => { cerrarHoja(); await abrirProyecto(b.dataset.usar); });
  c.querySelectorAll('[data-quitar]').forEach((b) => b.onclick = async () => {
    const p = S.proyectos.find((x) => x.id === b.dataset.quitar);
    const pend = (await obsDB.todas(p.id)).filter((o) => o.sync !== 'ok').length;
    if (!confirm(`¿Quitar "${p.nombre}" de este teléfono?${pend ? `\n\nOJO: tiene ${pend} observaciones sin enviar que se perderán.` : ''}`)) return;
    S.proyectos = S.proyectos.filter((x) => x.id !== p.id);
    await kv.set('proyectos', S.proyectos); await kv.del('datos:' + p.id);
    for (const o of await obsDB.todas(p.id)) await obsDB.borrar(o.id);
    if (S.actual === p.id) {
      detenerSim(false); detenerGPS(); salirDeVia();
      S.actual = null; S.datos = null; S.eje = null; S.elementos = []; S.obs = []; dibujarProyecto();
      if (S.proyectos[0]) await abrirProyecto(S.proyectos[0].id);
    }
    pantallaProyectos();
  });
  c.querySelector('#p-agregar').onclick = async () => {
    const d = leerEnlace(c.querySelector('#p-enlace').value);
    if (!d) return mostrarAviso('El enlace no es válido. Cópialo completo, incluida la parte "#p=…"');
    cerrarHoja(); await agregarProyecto(d);
  };
  c.querySelector('#p-archivo').onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!d.eje) throw new Error('sin eje');
      cerrarHoja(); await agregarArchivo(d);
    } catch { mostrarAviso('El archivo no es un proyecto válido'); }
  };
}

async function agregarProyecto(d) {
  let p = S.proyectos.find((x) => x.url === d.url);
  if (p) { p.k = d.k; p.nombre = d.nombre; }
  else { p = { id: uid(), ...d }; S.proyectos.push(p); }
  await kv.set('proyectos', S.proyectos);
  mostrarAviso(`Proyecto "${p.nombre}" agregado. Descargando datos…`, 'info');
  await abrirProyecto(p.id);
}

async function agregarArchivo(d) {
  const nombre = d.config?.NOMBRE || 'Proyecto';
  const p = { id: uid(), nombre, url: '', k: '' };
  S.proyectos.push(p);
  await kv.set('proyectos', S.proyectos);
  await kv.set('datos:' + p.id, d);
  await abrirProyecto(p.id);
  mostrarAviso(`Proyecto "${nombre}" abierto`, 'info');
}

// ---- ajustes ----
function pantallaAjustes() {
  const a = S.ajustes, tipos = [...new Set(S.elementos.map((e) => e.tipo))];
  const opc = (id, vals, act, fmt) => `<select id="${id}">${vals.map((v) => `<option value="${v}" ${v == act ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select>`;
  const c = hoja('Ajustes y avisos', `
    <label class="campo" for="a-nombre">Tu nombre (aparece en tus observaciones y fotos)</label>
    <input id="a-nombre" type="text" value="${esc(a.nombre)}" placeholder="Ej. Ing. Juan Pérez">
    <label class="campo">Avisos</label>
    <div class="chips">
      <label><input type="checkbox" id="a-voz" ${a.voz ? 'checked' : ''}> Voz</label>
      <label><input type="checkbox" id="a-vib" ${a.vibrar ? 'checked' : ''}> Vibración</label>
      <label><input type="checkbox" id="a-pant" ${a.pantalla ? 'checked' : ''}> Pantalla siempre encendida</label>
    </div>
    <label class="campo" for="a-cada">Avisar la progresiva cada</label>
    ${opc('a-cada', [0, 50, 100, 200, 500, 1000], a.cada, (v) => (v ? `${v} m` : 'No avisar'))}
    <label class="campo" for="a-dist">Avisar elementos cuando falten</label>
    ${opc('a-dist', [20, 30, 50, 100, 200], a.distAviso, (v) => `${v} m`)}
    <label class="campo" for="a-fuera">Avisar si me alejo del eje más de</label>
    ${opc('a-fuera', [20, 40, 60, 100, 200], a.fueraEje, (v) => `${v} m`)}
    <label class="campo">Elementos que quiero que me avise</label>
    <div class="chips" id="a-tipos">${tipos.map((t) => `<label><input type="checkbox" value="${esc(t)}" ${!a.tipos || a.tipos.includes(t) ? 'checked' : ''}>${miniTipo(t, colorTipo(t), 22)}${esc(nombreTipo(t))}</label>`).join('')}</div>
    <div class="botones"><button class="btn" id="a-probar">🔊 Probar aviso</button><button class="btn primario" id="a-guardar">Guardar</button></div>`);
  c.querySelector('#a-probar').onclick = () => { S.ajustes.voz = c.querySelector('#a-voz').checked; alerta('Prueba: en 50 m, alcantarilla', 'En 50 metros, alcantarilla T M C de 36 pulgadas'); };
  c.querySelector('#a-guardar').onclick = async () => {
    const marcados = [...c.querySelectorAll('#a-tipos input:checked')].map((x) => x.value);
    Object.assign(S.ajustes, {
      nombre: c.querySelector('#a-nombre').value.trim(), voz: c.querySelector('#a-voz').checked,
      vibrar: c.querySelector('#a-vib').checked, pantalla: c.querySelector('#a-pant').checked,
      cada: +c.querySelector('#a-cada').value, distAviso: +c.querySelector('#a-dist').value, fueraEje: +c.querySelector('#a-fuera').value,
      tipos: marcados.length === tipos.length ? null : marcados,
    });
    await kv.set('ajustes', S.ajustes);
    if (S.ajustes.pantalla) pedirPantalla(); else soltarPantalla();
    cerrarHoja(); mostrarAviso('Ajustes guardados', 'info'); pintarEstado();
  };
}

function pantallaNombre(luego) {
  const c = hoja('¿Cómo te llamas?', `
    <p>Tu nombre se guarda con cada observación y se imprime en tus fotos.</p>
    <input id="n-nombre" type="text" placeholder="Ej. Ing. Juan Pérez">
    <button class="btn primario" id="n-ok" style="width:100%;margin-top:12px">Continuar</button>`);
  c.querySelector('#n-ok').onclick = async () => {
    const v = c.querySelector('#n-nombre').value.trim();
    if (!v) return;
    S.ajustes.nombre = v; await kv.set('ajustes', S.ajustes);
    cerrarHoja(); luego?.();
  };
}

function pantallaDemo() {
  const desde = S.u && S.enVia ? Math.round(S.u.prog) : S.eje ? Math.round(ubicarLatLon(mapa.getCenter().lat, mapa.getCenter().lng).prog) : 0;
  const c = hoja('Modo demostración', `
    <p>Simula que caminas o vas en camioneta por el eje para probar los avisos sin salir de la oficina. Mientras dura, el GPS real queda en pausa.</p>
    <label class="campo" for="d-desde">Desde la progresiva</label><input id="d-desde" type="text" value="${fmtProg(desde)}">
    <label class="campo" for="d-vel">Velocidad</label>
    <select id="d-vel"><option value="5">Caminando (5 km/h)</option><option value="20" selected>Camioneta lenta (20 km/h)</option><option value="40">Camioneta (40 km/h)</option><option value="150">Rápido (150 km/h)</option></select>
    <label class="campo">Sentido</label>
    <div class="chips" id="d-sent"><button class="sel" data-s="1">Progresiva creciente</button><button data-s="-1">Decreciente</button></div>
    <div class="botones"><button class="btn" id="d-parar">Terminar simulación</button><button class="btn primario" id="d-ir">▶ Simular</button></div>`);
  let sent = 1;
  c.querySelectorAll('#d-sent button').forEach((b) => b.onclick = () => { sent = +b.dataset.s; c.querySelectorAll('#d-sent button').forEach((x) => x.classList.toggle('sel', x === b)); });
  c.querySelector('#d-ir').onclick = () => {
    const p = parseProg(c.querySelector('#d-desde').value);
    if (p == null || !S.eje) return mostrarAviso('Progresiva no válida');
    cerrarHoja();
    iniciarSim(p, +c.querySelector('#d-vel').value, sent);
  };
  c.querySelector('#d-parar').onclick = () => { cerrarHoja(); detenerSim(); };
}

function pantallaAyuda() {
  hoja('Cómo se usa', `
    <ol style="padding-left:20px;margin:0">
      <li>Al abrir la app el GPS se enciende solo. Arriba verás la progresiva donde estás y a qué lado del eje vas (izquierda o derecha <b>según hacia dónde avanzas</b>).</li>
      <li>El indicador <b>▲ hacia 56+687</b> muestra tu sentido de avance. Se detecta solo al moverte; si estás quieto y está al revés, tócalo para invertirlo.</li>
      <li>La app avisa con voz y vibración cada 100 m y al acercarte a cada elemento, diciendo si está a tu izquierda o a tu derecha. Toca la pantalla una vez al abrir la app para activar la voz.</li>
      <li><b>📷 Foto</b> o <b>＋ Observación</b>: la cámara de la app imprime en la foto la progresiva, el lado, las coordenadas, la fecha y tu nombre. También puedes adjuntar fotos de TimeStampCam desde «Galería».</li>
      <li>Sin señal también funciona: las observaciones se guardan en el teléfono y se envían solas cuando vuelve internet.</li>
      <li>Lejos de la vía (o con el GPS en pausa), la mira <b>+</b> del centro del mapa te dice la progresiva del punto que mires.</li>
      <li>En el mapa: cuadros de color = elementos de obra (cada tipo con su dibujo), flecha azul = tú, gota = observación, triángulo negro = BM.</li>
      <li>Para ahorrar batería: ☰ → <b>Pausar GPS</b>.</li>
    </ol>
    <p class="ayuda">En iPhone, los avisos funcionan con la app abierta y la pantalla encendida.</p>`);
}

// ================= botones y arranque =================
$('#btn-obs').onclick = () => abrirObs();
$('#btn-foto').onclick = () => abrirObs(null, { camara: true });
$('#btn-menu').onclick = menu;
$('#btn-centrar').onclick = () => {
  if (S.pos) {
    if (S.enVia) setSeguir(true);
    mapa.setView([S.pos.lat, S.pos.lon], Math.max(mapa.getZoom(), 16));
  } else mostrarAviso(S.pausado ? 'El GPS está en pausa (☰ → Reanudar GPS)' : 'Todavía no hay señal GPS');
};

function bienvenida() {
  const c = hoja('Bienvenido', `
    <p><b>Recorrido de Obra</b> te muestra el eje de la vía, los elementos a ejecutar y la progresiva donde estás.</p>
    <p>Para empezar, abre el <b>enlace del proyecto</b> que te envió el responsable (por WhatsApp o correo), o pégalo aquí:</p>
    <textarea id="w-enlace" placeholder="Pega aquí el enlace del proyecto" style="min-height:70px"></textarea>
    <button class="btn primario" id="w-ok" style="width:100%;margin-top:8px">Agregar proyecto</button>
    <label class="btn" style="display:flex;align-items:center;justify-content:center;margin-top:8px">Abrir archivo de proyecto (.json)<input id="w-archivo" type="file" accept=".json,application/json" hidden></label>`);
  c.querySelector('#w-ok').onclick = async () => {
    const d = leerEnlace(c.querySelector('#w-enlace').value);
    if (!d) return mostrarAviso('El enlace no es válido');
    cerrarHoja(); await agregarProyecto(d);
  };
  c.querySelector('#w-archivo').onchange = async (e) => {
    try { const d = JSON.parse(await e.target.files[0].text()); if (!d.eje) throw 0; cerrarHoja(); await agregarArchivo(d); }
    catch { mostrarAviso('El archivo no es un proyecto válido'); }
  };
}

// ---- actualización de la app ----
// El service worker nuevo toma el control apenas se instala; aquí se recarga la página para usarlo.
function vigilarActualizaciones() {
  if (!('serviceWorker' in navigator)) return;
  const habia = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const revisar = () => reg.update().catch(() => {});
    setInterval(revisar, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisar(); });
  }).catch(() => {});
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habia || recargando) return;
    const ocupado = !$('#hoja').classList.contains('oculto') || $('#camara');
    if (!ocupado) { recargando = true; location.reload(); return; }
    // hay un formulario abierto: no se interrumpe; se ofrece actualizar al terminar
    if ($('#actualizar')) return;
    const b = document.createElement('button');
    b.id = 'actualizar';
    b.textContent = '⬆ Nueva versión de la app lista · Toca para actualizar';
    b.onclick = () => { recargando = true; location.reload(); };
    document.body.appendChild(b);
  });
}

async function arrancar() {
  vigilarActualizaciones();
  S.ajustes = { ...AJUSTES_BASE, ...(await kv.get('ajustes')) };
  S.proyectos = (await kv.get('proyectos')) || [];
  const vPrev = await kv.get('version_app');
  if (vPrev !== VERSION_APP) {
    await kv.set('version_app', VERSION_APP);
    if (vPrev) setTimeout(() => mostrarAviso(`App actualizada a la versión ${VERSION_APP}`, 'info'), 1500);
  }
  const inv = leerEnlace(location.hash);
  const archivo = location.hash.match(/#archivo=(.+)$/);
  history.replaceState(null, '', location.pathname + location.search);
  if (inv) {
    await agregarProyecto(inv);
  } else if (archivo) {
    try { await agregarArchivo(await (await fetch(decodeURIComponent(archivo[1]))).json()); } catch { mostrarAviso('No se pudo abrir el archivo del proyecto'); }
  } else {
    const act = await kv.get('actual');
    const id = S.proyectos.some((p) => p.id === act) ? act : S.proyectos[0]?.id;
    if (id) await abrirProyecto(id);
  }
  if (!S.proyectos.length) bienvenida();
  else if (!S.ajustes.nombre) pantallaNombre();
  pintarEstado();
}
arrancar();
window.__recorrido = { S, alPosicion, iniciarSim, detenerSim, pausarGPS };
