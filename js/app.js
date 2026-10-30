// Recorrido de Obra: mapa del eje, progresiva en vivo, avisos y observaciones.
import { Eje, latLonAUtm, utmALatLon, fmtProg, parseProg, fmtLado, fmtLadoProg } from './geo.js';
import { kv, obsDB, uid } from './store.js';
import { api, leerEnlace, irAGoogle, leerRegreso, ErrorServidor } from './api.js';
import { leerExif, reducir } from './fotos.js';
import { iconoElemento, iconoPunto, iconoUsuario, miniTipo, svgPunto } from './iconos.js';
import { leerSecciones, seccionEn, svgSeccion } from './seccion.js';
import { abrirCamara, componer, ESTILO_BASE } from './camara.js';
import { abrirVisor, medidas, miniatura, nombreCorto } from './laminas.js';

const VERSION_APP = '2.3.0';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RAD = Math.PI / 180;
const EN_VIA_M = 1000; // más lejos del eje que esto, la app pasa a modo consulta (mira +)

const AJUSTES_BASE = {
  nombre: '', voz: true, vibrar: true, pantalla: true,
  cada: 100, distAviso: 50, fueraEje: 40, tipos: null, // null = todos
  fotoLogo: true, fotoMapa: true, fotoBrujula: true, // qué se imprime en las fotos
  estiloFoto: null, // opacidades del sello (null = ESTILO_BASE)
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
  proyectos: [], actual: null, datos: null, eje: null, tipos: {}, elementos: [], puntos: [], secciones: [],
  laminas: [], lamCache: {}, lamURL: {}, lamSel: null, lamFirma: '', elemPend: [],
  ajustes: { ...AJUSTES_BASE }, obs: [],
  pos: null, u: null, watch: null, pausado: false, gpsError: '', enVia: false, seguir: true, sim: null, wake: null,
  hist: [], dir: 1, ultTramo: null, avisados: new Set(), fueraCont: 0, avisoFuera: false,
  audioListo: false, encuadrar: false, mkYo: null, circPrec: null,
};
const proyActual = () => S.proyectos.find((p) => p.id === S.actual);
// conexión con el servidor del proyecto, con la sesión de quien usa el teléfono
const A = () => api(proyActual(), S.sesion);
const ROL_NOMBRE = { campo: 'Campo', tecnico: 'Técnico', total: 'Acceso total', admin: 'Administrador' };
const NIVEL = { campo: 0, tecnico: 1, total: 2, admin: 3 };
const puede = (rol) => !proyActual()?.url || (NIVEL[S.sesion?.rol] ?? -1) >= NIVEL[rol];
const autorizado = () => !proyActual()?.url || S.sesion?.estado === 'AUTORIZADO';

// ================= mapa =================
const mapa = L.map('mapa', { zoomControl: false, attributionControl: true }).setView([-5.1, -78.9], 12);
// la mira va dentro del mapa: así marca el centro real aunque la barra de arriba cambie de alto
mapa.getContainer().appendChild($('#mira'));
// si la barra de arriba crece o se achica, el mapa recalcula su centro sin moverse del punto que mirabas
if (window.ResizeObserver) new ResizeObserver(() => mapa.invalidateSize({ animate: false })).observe(mapa.getContainer());
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
G.marca = L.layerGroup().addTo(mapa); // punto de la ficha de progresiva abierta
L.control.layers(capasBase, {
  'Elementos de obra': G.elem, 'Observaciones': G.obs, 'Puntos de control (BM)': G.bm, 'Marcas cada 100 m': G.cien,
}, { position: 'topright' }).addTo(mapa);
L.control.zoom({ position: 'topleft' }).addTo(mapa);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);
let cienAuto = true;
mapa.on('overlayremove', (e) => { if (e.layer === G.cien) cienAuto = false; });
const zoomClases = () => {
  mapa.getContainer().classList.toggle('lejos', mapa.getZoom() < 14);
  mapa.getContainer().classList.toggle('cerca', mapa.getZoom() >= 16);
};
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
  const ll = S.ejeLL;
  L.polyline(ll, { color: '#000', weight: 7, opacity: .55, interactive: false }).addTo(G.eje);
  L.polyline(ll, { color: '#ffd54f', weight: 4, opacity: 1 }).addTo(G.eje)
    .on('click', (e) => fichaProgresiva(ubicarLatLon(e.latlng.lat, e.latlng.lng).prog));
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
    const anulado = e.estado === 'ANULADO';
    const color = anulado ? '#9e9e9e' : colorTipo(e.tipo), off = offLado(e.lado);
    const tramo = e.fin != null && Math.abs(e.fin - e.ini) > 1;
    // tramos: línea de color a lo largo del eje; el icono va en el punto medio
    if (tramo) L.polyline(S.eje.tramoLatLon(e.ini, e.fin, off), { color, weight: 6, opacity: anulado ? .5 : .9, dashArray: anulado ? '6 8' : null })
      .bindPopup(() => popupElemento(e)).addTo(G.elem);
    const p = tramo ? (e.ini + e.fin) / 2 : e.ini;
    e.capa = L.marker(S.eje.puntoLatLon(p, off), {
      icon: iconoElemento(e.tipo, color, anulado ? 'anulado' : e.pendiente ? 'pendiente' : ''),
      title: `${e.codigo} · ${e.desc}${anulado ? ' (ANULADO)' : ''}`, riseOnHover: true, zIndexOffset: anulado ? -500 : 0,
    }).bindPopup(() => popupElemento(e)).addTo(G.elem);
    // si se movió: punto y línea gris a la ubicación que tenía en el expediente
    if (movido(e)) {
      const offE = offLado(e.ladoExp), tramoE = e.finExp != null && Math.abs(e.finExp - e.iniExp) > 1;
      const pE = S.eje.puntoLatLon(tramoE ? (e.iniExp + e.finExp) / 2 : e.iniExp, offE);
      if (tramoE) L.polyline(S.eje.tramoLatLon(e.iniExp, e.finExp, offE), { color: '#fff', weight: 4, opacity: .9, dashArray: '6 6', interactive: false }).addTo(G.elem);
      L.polyline([pE, e.capa.getLatLng()], { color: '#fff', weight: 5, opacity: .7, interactive: false }).addTo(G.elem);
      L.polyline([pE, e.capa.getLatLng()], { color: '#212121', weight: 2, opacity: .9, dashArray: '4 4', interactive: false }).addTo(G.elem);
      L.circleMarker(pE, { radius: 7, color: '#212121', weight: 2, dashArray: '3 2', fillColor: '#fff', fillOpacity: .9 })
        .bindTooltip(`${e.codigo}: ubicación del expediente (Km ${fmtProg(e.iniExp)}${e.ladoExp ? ' ' + e.ladoExp : ''})`).addTo(G.elem);
    }
  }
  for (const p of S.puntos) {
    p.capa = L.marker([p.lat, p.lon], { icon: iconoPunto(p.tipo, p.estado, p.codigo), title: p.codigo })
      .bindPopup(() => popupPunto(p)).addTo(G.bm);
  }
  dibujarObs();
}

// ---- puntos de control (red geodésica y BM) ----
const RUMBOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const rumbo = (dE, dN) => { const a = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360; return `${RUMBOS[Math.round(a / 45) % 8]} (${Math.round(a)}°)`; };
const NOMBRE_TIPO_PUNTO = { GEODESICO: 'Geodésico', BM: 'BM', PC: 'Punto de control', OTRO: 'Punto' };

function leerPuntos(datos) {
  const filas = datos.puntos?.length ? datos.puntos
    : (datos.bm || []).map((b) => ({ CODIGO: b.CODIGO, TIPO: 'BM', E: b.E, N: b.N, ESTADO: 'VIGENTE' })); // proyectos sin hoja PUNTOS
  return filas.filter((r) => r.CODIGO && r.E !== '' && r.N !== '' && !isNaN(+r.E)).map((r) => {
    const E = +r.E, N = +r.N, u = S.eje ? S.eje.ubicar(E, N) : null;
    const [lat, lon] = utmALatLon(E, N, S.eje?.zona || 17, S.eje ? S.eje.sur : true);
    return {
      codigo: String(r.CODIGO), anterior: r.CODIGO_ANTERIOR || '', tipo: String(r.TIPO || 'BM').toUpperCase(), orden: r.ORDEN || '',
      E, N, cota: r.COTA === '' || r.COTA == null ? null : +r.COTA, estado: String(r.ESTADO || 'VIGENTE').toUpperCase(),
      fuente: r.FUENTE || '', fecha: r.FECHA || '', obs: r.OBS || '', lat, lon, prog: u?.prog ?? null, off: u?.off ?? null,
    };
  }).sort((a, b) => (a.prog ?? 0) - (b.prog ?? 0));
}

// Distancia y rumbo desde tu posición (si hay GPS reciente)
function desdeMi(E, N) {
  if (!S.pos || Date.now() - S.pos.t > 30000 || S.pos.simulada) return null;
  const [e0, n0] = latLonAUtm(S.pos.lat, S.pos.lon, S.eje.zona, S.eje.sur);
  const d = Math.hypot(E - e0, N - n0);
  return { d, txt: `${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(2) + ' km'} al ${rumbo(E - e0, N - n0)}` };
}

const etqEstadoPunto = (e) => `<span class="etq ${e === 'VIGENTE' ? 'ok' : e === 'OBSERVADO' ? 'mal' : ''}">${esc(e)}</span>`;

function popupPunto(p) {
  const d = document.createElement('div'), mi = desdeMi(p.E, p.N);
  d.innerHTML = `<h3><span class="ico-punto">${svgPunto(p.tipo, p.estado, 18)}</span> ${esc(p.codigo)}</h3>${esc(NOMBRE_TIPO_PUNTO[p.tipo] || p.tipo)}${p.orden ? ` · ${esc(p.orden)}` : ''} ${etqEstadoPunto(p.estado)}
    ${p.obs ? `<p class="ayuda">${esc(p.obs)}</p>` : ''}${p.anterior ? `<div class="ayuda">También: ${esc(p.anterior)}</div>` : ''}
    <div style="font-variant-numeric:tabular-nums;margin-top:4px">E ${p.E.toFixed(3)} · N ${p.N.toFixed(3)}${p.cota != null ? `<br>Cota ${p.cota.toFixed(3)} m` : ''}</div>
    ${p.prog != null ? `<div>Km ${fmtProg(p.prog)} · ${fmtLadoProg(p.off)} del eje</div>` : ''}
    ${mi ? `<div><b>Estás a ${mi.txt}</b></div>` : ''}
    <div class="fila" style="margin-top:6px"><button class="btn crece" data-a="copiar">Copiar coordenadas</button>${p.prog != null ? '<button class="btn crece" data-a="ficha">Ficha Km</button>' : ''}</div>`;
  d.querySelector('[data-a="copiar"]').onclick = async () => {
    const t = `${p.codigo}\tE ${p.E.toFixed(4)}\tN ${p.N.toFixed(4)}${p.cota != null ? `\tZ ${p.cota.toFixed(4)}` : ''}`;
    try { await navigator.clipboard.writeText(t); mostrarAviso('Coordenadas copiadas', 'info'); } catch { mostrarAviso(t, 'info'); }
  };
  d.querySelector('[data-a="ficha"]')?.addEventListener('click', () => { mapa.closePopup(); fichaProgresiva(p.prog); });
  return d;
}

function pantallaPuntos() {
  let filtro = '';
  const c = hoja('Puntos de control', `
    <input id="pc-txt" type="search" placeholder="Buscar código (nuevo o anterior)">
    <div class="chips" id="pc-f" style="margin:10px 0"><button class="sel" data-f="">Todos</button><button data-f="GEODESICO">Geodésicos</button><button data-f="BM">BM</button><button data-f="OBSERVADO">Observados</button></div>
    <div id="pc-lista"></div>`);
  const pintar = () => {
    const q = c.querySelector('#pc-txt').value.trim().toLowerCase();
    const lst = S.puntos.filter((p) => (!filtro || p.tipo === filtro || p.estado === filtro) && (!q || (p.codigo + ' ' + p.anterior).toLowerCase().includes(q)));
    c.querySelector('#pc-lista').innerHTML = lst.map((p) => {
      const mi = desdeMi(p.E, p.N);
      return `<button class="item" data-c="${esc(p.codigo)}">
        <span class="ico-punto">${svgPunto(p.tipo, p.estado, 22)}</span>
        <span><span class="t">${esc(p.codigo)}</span>${p.anterior ? ` <span class="s">(${esc(p.anterior)})</span>` : ''}<br>
        <span class="s">${p.cota != null ? `Cota ${p.cota.toFixed(3)} · ` : ''}${p.prog != null ? `Km ${fmtProg(p.prog)} ${fmtLadoProg(p.off)}` : ''}</span>${mi ? `<br><span class="s"><b>${mi.txt}</b></span>` : ''}</span>
        <span class="der">${etqEstadoPunto(p.estado)}</span></button>`;
    }).join('') || '<p class="ayuda">No hay puntos con ese filtro.</p>';
    c.querySelectorAll('.item').forEach((b) => b.onclick = () => {
      const p = S.puntos.find((x) => x.codigo === b.dataset.c);
      cerrarHoja(); setSeguir(false); G.bm.addTo(mapa);
      mapa.setView([p.lat, p.lon], 17);
      setTimeout(() => p.capa?.openPopup(), 300);
    });
  };
  c.querySelector('#pc-txt').oninput = pintar;
  c.querySelectorAll('#pc-f button').forEach((b) => b.onclick = () => { filtro = b.dataset.f; c.querySelectorAll('#pc-f button').forEach((x) => x.classList.toggle('sel', x === b)); pintar(); });
  pintar();
}

// ---- ficha de progresiva: sección típica, alineamiento, elementos, puntos y observaciones ----
// Curvatura por el círculo que pasa por tres puntos del eje (±20 m)
function curvaEn(prog) {
  const a = S.eje.punto(Math.max(prog - 20, S.eje.inicio)), b = S.eje.punto(prog), c = S.eje.punto(Math.min(prog + 20, S.eje.fin));
  const cruz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(cruz) < 1e-6) return { recta: true };
  const R = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1]) / (2 * Math.abs(cruz));
  return R > 400 ? { recta: true, R } : { R, lado: cruz > 0 ? 'LI' : 'LD' }; // giro antihorario = curva a la izquierda
}

function fichaProgresiva(prog) {
  if (!S.eje || prog == null) return;
  prog = Math.min(Math.max(prog, S.eje.inicio), S.eje.fin);
  const [E, N] = S.eje.punto(prog), pt = utmALatLon(E, N, S.eje.zona, S.eje.sur);
  G.marca.clearLayers();
  L.circleMarker(pt, { radius: 11, color: '#ffb300', weight: 4, fill: false, interactive: false }).addTo(G.marca);
  const sec = seccionEn(S.secciones, prog), curva = curvaEn(prog);
  const elems = S.elementos.map((e) => {
    const a = Math.min(e.ini, e.fin ?? e.ini), b = Math.max(e.ini, e.fin ?? e.ini);
    return { e, d: prog < a ? a - prog : prog > b ? b - prog : 0 };
  }).filter((x) => Math.abs(x.d) <= 150).sort((x, y) => Math.abs(x.d) - Math.abs(y.d));
  const ptos = S.puntos.map((p) => ({ p, d: Math.hypot(p.E - E, p.N - N) })).sort((x, y) => x.d - y.d).slice(0, 3);
  const obs = S.obs.filter((o) => o.estado !== 'ANULADA' && Math.abs(o.prog - prog) <= 200).sort((x, y) => Math.abs(x.prog - prog) - Math.abs(y.prog - prog));
  const mi = desdeMi(E, N);
  const total = sec ? sec.capas.reduce((s, c) => s + c.cm, 0) : 0;

  const c = hoja(`Km ${fmtProg(prog)}`, `
    <div class="ficha-cab"><span class="ayuda">E ${E.toFixed(1)} · N ${N.toFixed(1)}${mi ? `<br><b>Estás a ${mi.txt}</b>` : ''}</span>
      <span class="pasos"><button data-p="-100">◀ 100</button><button data-p="-20">◀ 20</button><button data-p="20">20 ▶</button><button data-p="100">100 ▶</button></span></div>

    <h3 class="ficha-t">Alineamiento</h3>
    ${curva.recta ? '<p>Tramo en recta (o curva muy amplia).</p>'
      : `<div class="aviso-linea">Curva hacia la <b>${curva.lado === 'LI' ? 'izquierda' : 'derecha'}</b> · radio ≈ <b>${Math.round(curva.R)} m</b>.
         El sobreancho va al lado interno (<b>${curva.lado}</b>).</div>`}

    <h3 class="ficha-t">Sección típica y paquete estructural</h3>
    <div id="fk-lam"></div>
    ${sec ? `<table class="tabla">
        <tr><td>Calzada</td><td>${(2 * sec.carril).toFixed(2)} m (2 × ${sec.carril.toFixed(2)})</td></tr>
        <tr><td>Bermas</td><td>2 × ${sec.berma.toFixed(2)} m</td></tr>
        <tr><td>Plataforma</td><td>${(2 * (sec.carril + sec.berma)).toFixed(2)} m</td></tr>
        <tr><td>Bombeo</td><td>${sec.bombeo} %</td></tr>
        ${sec.cunetaAncho ? `<tr><td>Cuneta</td><td>${sec.cunetaAncho.toFixed(2)} × ${(sec.cunetaProf || 0).toFixed(2)} m</td></tr>` : ''}
        ${sec.capas.map((k) => `<tr><td>${esc(k.nombre)}</td><td>${String(k.cm).replace('.', ',')} cm</td></tr>`).join('')}
        <tr class="total"><td>Espesor total del paquete</td><td>${String(Math.round(total * 10) / 10).replace('.', ',')} cm</td></tr>
        ${sec.taludCorte ? `<tr><td>Talud de corte</td><td style="white-space:normal">${esc(sec.taludCorte)}</td></tr>` : ''}
        ${sec.taludRelleno ? `<tr><td>Talud de relleno</td><td style="white-space:normal">${esc(sec.taludRelleno)}</td></tr>` : ''}
      </table>
      ${sec.obs ? `<p class="ayuda">${esc(sec.obs)}</p>` : ''}
      <p class="ayuda">${esc(sec.nombre)}${sec.fuente ? ` · Fuente: ${esc(sec.fuente)}` : ''}.</p>`
      : '<p class="ayuda">El proyecto aún no tiene cargada la sección típica (hoja SECCION_TIPICA).</p>'}

    <h3 class="ficha-t">Elementos de obra (±150 m)</h3>
    ${elems.map(({ e, d }) => `<button class="item ${e.estado === 'ANULADO' ? 'anulado' : ''}" data-e="${S.elementos.indexOf(e)}">${miniTipo(e.tipo, e.estado === 'ANULADO' ? '#9e9e9e' : colorTipo(e.tipo))}
      <span><span class="t">${esc(e.codigo)}</span>${e.estado !== 'PENDIENTE' ? ' ' + etqEstadoElem(e.estado) : ''}<br><span class="s">${esc(e.desc)}</span></span>
      <span class="der">${d === 0 ? 'aquí' : `${Math.abs(Math.round(d))} m ${d > 0 ? 'adelante' : 'atrás'}`}<br><span class="s">${e.lado || ''}</span></span></button>`).join('') || '<p class="ayuda">Ninguno en este tramo.</p>'}

    <h3 class="ficha-t">Puntos de control más cercanos</h3>
    ${ptos.map(({ p, d }) => `<button class="item" data-c="${esc(p.codigo)}"><span class="ico-punto">${svgPunto(p.tipo, p.estado, 22)}</span>
      <span><span class="t">${esc(p.codigo)}</span>${p.anterior ? ` <span class="s">(${esc(p.anterior)})</span>` : ''}<br>
      <span class="s">${p.cota != null ? `Cota ${p.cota.toFixed(3)} m · ` : ''}a ${Math.round(d)} m de este punto</span></span>
      <span class="der">${etqEstadoPunto(p.estado)}</span></button>`).join('') || '<p class="ayuda">El proyecto no tiene puntos de control cargados.</p>'}

    <h3 class="ficha-t">Observaciones (±200 m)</h3>
    ${obs.map((o) => `<button class="item" data-o="${esc(o.id)}"><span><span class="t">${esc(o.categoria)} · Km ${fmtProg(o.prog)}</span><br>
      <span class="s">${esc((o.texto || '').slice(0, 70))}</span></span><span class="der"><span class="etq ${o.estado === 'LEVANTADA' ? 'ok' : 'mal'}">${esc(o.estado)}</span></span></button>`).join('') || '<p class="ayuda">Ninguna en este tramo.</p>'}

    <div class="botones"><button class="btn" id="fk-mapa">Ver en el mapa</button><button class="btn primario" id="fk-obs">＋ Observación aquí</button></div>
    ${puede('tecnico') ? '<button class="btn" id="fk-elem" style="width:100%;margin-top:8px">＋ Nuevo elemento aquí</button>' : ''}`);

  c.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
    const p = prog + +b.dataset.p;
    if (!S.enVia || !S.seguir) mapa.panTo(S.eje.puntoLatLon(Math.min(Math.max(p, S.eje.inicio), S.eje.fin)));
    fichaProgresiva(p);
  });
  c.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => {
    const e = S.elementos[+b.dataset.e];
    cerrarHoja(); setSeguir(false); mapa.setView(e.capa.getLatLng(), 17); setTimeout(() => e.capa?.openPopup(), 300);
  });
  c.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
    const p = S.puntos.find((x) => x.codigo === b.dataset.c);
    cerrarHoja(); setSeguir(false); G.bm.addTo(mapa); mapa.setView([p.lat, p.lon], 17); setTimeout(() => p.capa?.openPopup(), 300);
  });
  c.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => abrirObs(b.dataset.o));
  c.querySelector('#fk-mapa').onclick = () => { cerrarHoja(); setSeguir(false); mapa.setView(pt, Math.max(mapa.getZoom(), 17)); };
  c.querySelector('#fk-obs').onclick = () => abrirObs(null, { prog, off: 0, fuente: 'Ficha de progresiva' });
  c.querySelector('#fk-elem')?.addEventListener('click', () => editarElemento(null, { prog }));
  S.fichaProg = { prog, curva, sec };
  pintarLaminaFicha();
}

// ---- láminas de planos (SVG del expediente) ----
// El servidor manda solo la lista; cada lámina se descarga aparte, una vez, y queda en el teléfono.
function leerLaminas(datos) {
  return (datos.laminas || []).filter((l) => l.clave).map((l) => {
    let enfoques = {};
    try { enfoques = typeof l.enfoques === 'string' ? JSON.parse(l.enfoques || '{}') : l.enfoques || {}; } catch { /* sin enfoques */ }
    const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
    return { clave: String(l.clave), titulo: String(l.titulo || l.clave), tipo: l.tipo || 'OTRO', ini: num(l.progIni), fin: num(l.progFin),
      enfoques, fuente: l.fuente || '', actualizado: l.actualizado || '', svg: l.svg };
  });
}
const laminasEn = (prog, tipo) => S.laminas.filter((l) => (!tipo || l.tipo === tipo) && (l.ini == null || prog >= l.ini) && (l.fin == null || prog <= l.fin));

let lamCola = Promise.resolve();
const colaLaminas = () => { lamCola = lamCola.then(prepararLaminas).catch(() => {}); };
async function prepararLaminas() {
  const p = proyActual();
  if (!p) return;
  const id = p.id, lista = S.laminas;
  const guardadas = (await kv.get('laminas:' + id)) || {};
  let cambio = false;
  // proyecto de archivo: las láminas vienen dentro del archivo
  for (const l of lista) if (l.svg && guardadas[l.clave]?.actualizado !== l.actualizado) { guardadas[l.clave] = { actualizado: l.actualizado, svg: l.svg, ...medidas(l.svg) }; cambio = true; }
  for (const k of Object.keys(guardadas)) if (!lista.some((l) => l.clave === k)) { delete guardadas[k]; cambio = true; }
  if (cambio) await kv.set('laminas:' + id, guardadas);
  if (S.actual !== id) return;
  S.lamCache = guardadas;
  pintarLaminaFicha();
  if (!p.url || !navigator.onLine || !autorizado()) return;
  for (const l of lista) {
    if (guardadas[l.clave]?.svg && guardadas[l.clave].actualizado === l.actualizado) continue;
    try {
      const r = await A().llamar('lamina', { clave: l.clave });
      if (S.actual !== id) return;
      guardadas[l.clave] = { actualizado: l.actualizado, svg: r.svg, ...medidas(r.svg) };
      await kv.set('laminas:' + id, guardadas);
      S.lamCache = guardadas;
      pintarLaminaFicha();
    } catch (e) { if (!(await manejarAcceso(e))) pintarLaminaFicha('No se pudo descargar la lámina: ' + e.message); return; }
  }
}

function urlLamina(clave) {
  const g = S.lamCache[clave], k = clave + '|' + g.actualizado;
  if (!S.lamURL[k]) {
    for (const x of Object.keys(S.lamURL)) if (x.startsWith(clave + '|')) { URL.revokeObjectURL(S.lamURL[x]); delete S.lamURL[x]; }
    S.lamURL[k] = URL.createObjectURL(new Blob([g.svg], { type: 'image/svg+xml' }));
  }
  return S.lamURL[k];
}

// Bloque de la ficha: pestañas por tipo de sección, la lámina recortada en la sección y accesos a sus detalles.
// Sin láminas cargadas queda el esquema dibujado con los datos de SECCION_TIPICA.
function pintarLaminaFicha(error = '') {
  const c = $('#fk-lam');
  if (!c || !S.fichaProg) return;
  const { prog, curva, sec } = S.fichaProg;
  const tipicas = laminasEn(prog, 'SECCION_TIPICA'), otras = laminasEn(prog).filter((l) => l.tipo !== 'SECCION_TIPICA');
  if (!tipicas.length) {
    c.innerHTML = sec ? `${svgSeccion(sec, { sobreancho: curva.recta ? null : curva.lado })}
      <p class="ayuda">Esquema: anchos a escala, capas exageradas en vertical.</p>` : '';
    return;
  }
  const l = tipicas.find((x) => x.clave === S.lamSel) || tipicas[0];
  const g = S.lamCache[l.clave];
  const enf = l.enfoques['Sección'] || Object.values(l.enfoques)[0];
  c.innerHTML = `${tipicas.length > 1 ? `<div class="chips lam-tabs">${tipicas.map((x) => `<button data-l="${esc(x.clave)}" class="${x === l ? 'sel' : ''}">${esc(nombreCorto(x.titulo))}</button>`).join('')}</div>` : ''}
    ${g ? `<button class="lam-ver" data-k="Sección">${miniatura(urlLamina(l.clave), g.W, g.H, enf)}
        <span class="lam-pie"><span>${esc(l.clave)} · ${esc(l.titulo)}</span><b>⤢ Ampliar</b></span></button>
      <div class="chips lam-chips">${Object.keys(l.enfoques).filter((k) => k !== 'Sección').map((k) => `<button data-k="${esc(k)}">${esc(k)}</button>`).join('')}
        <button data-k="">Lámina completa</button></div>`
      : `<div class="lam-espera">${error ? esc(error) : navigator.onLine ? 'Descargando la lámina del plano…' : 'La lámina se descargará cuando haya internet.'}</div>`}
    ${!curva.recta ? `<p class="ayuda">En las láminas el sobreancho (SA) está dibujado a la izquierda; en esta curva va al lado <b>${curva.lado === 'LI' ? 'izquierdo (LI)' : 'derecho (LD)'}</b>.</p>` : ''}
    ${otras.length ? `<div class="chips lam-chips">${otras.map((x) => `<button data-o-lam="${esc(x.clave)}">📐 ${esc(x.titulo)}</button>`).join('')}</div>` : ''}
    <p class="ayuda">Láminas del expediente técnico. Qué sección corresponde aquí (corte, relleno o media ladera) se verá con las secciones transversales.</p>`;
  c.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { S.lamSel = b.dataset.l; pintarLaminaFicha(); });
  c.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => abrirLamina(l, b.dataset.k));
  c.querySelectorAll('[data-o-lam]').forEach((b) => b.onclick = () => abrirLamina(S.laminas.find((x) => x.clave === b.dataset.oLam), ''));
}

function abrirLamina(l, enfoque) {
  const g = l && S.lamCache[l.clave];
  if (!g) return mostrarAviso(navigator.onLine ? 'La lámina aún se está descargando' : 'La lámina se descargará cuando haya internet');
  try { abrirVisor({ titulo: `${l.clave} · ${l.titulo}`, svg: g.svg, enfoques: l.enfoques, inicial: enfoque }); }
  catch (e) { mostrarAviso('No se pudo abrir la lámina: ' + e.message); }
}

const offLado =(lado) => (lado === 'LI' ? -5 : lado === 'LD' ? 5 : 0);
const descSinLado = (d) => String(d).replace(/\s*\b(LI|LD)\b/g, '').trim();
// LI/LD de los planos (sentido de la progresiva) convertido al sentido en que avanzas
const ladoRel = (lado) => (!lado ? '' : (lado === 'LI') === (S.dir > 0) ? 'izquierda' : 'derecha');

function popupElemento(e) {
  const d = document.createElement('div');
  const lado = e.lado ? `<br>Lado: ${e.lado === 'LI' ? 'izquierdo (LI)' : 'derecho (LD)'} según la progresiva${S.enVia ? ` · <b>a tu ${ladoRel(e.lado)}</b>` : ''}` : '';
  const editar = puede('tecnico');
  d.innerHTML = `<h3>${esc(e.codigo)}</h3>${esc(e.desc)}<br>
    <b>Km ${fmtUbic(e.ini, e.fin)}</b>${lado}<br>
    Estado: ${etqEstadoElem(e.estado)}${e.pendiente ? ' <span class="etq pend">por enviar</span>' : ''}
    ${movido(e) ? `<br><span class="ayuda">En el expediente: Km ${fmtUbic(e.iniExp, e.finExp)}${e.ladoExp ? ' ' + e.ladoExp : ''}</span>` : ''}
    ${e.origen === 'NUEVO' ? '<br><span class="ayuda">No está en el expediente (agregado en obra)</span>' : ''}
    ${e.obs ? `<p class="ayuda">${esc(e.obs)}</p>` : ''}
    ${e.actualizadoPor ? `<br><span class="ayuda">Último cambio:${esc(e.actualizadoPor)}${e.actualizado ? ' · ' + fechaCorta(e.actualizado) : ''}</span>` : ''}
    <div class="fila" style="margin-top:8px"><button class="btn primario crece" data-a="obs">＋ Observación</button><button class="btn crece" data-a="ficha">Ficha Km</button></div>
    ${editar || proyActual()?.url ? `<div class="fila" style="margin-top:6px">${editar ? '<button class="btn crece" data-a="editar">✎ Editar / mover</button>' : ''}
      ${proyActual()?.url ? '<button class="btn crece" data-a="hist">🕘 Historial</button>' : ''}</div>` : ''}`;
  d.querySelector('[data-a="obs"]').onclick = () => { mapa.closePopup(); abrirObs(null, { elemento: e.codigo, prog: e.ini, off: offLado(e.lado), fuente: 'Elemento' }); };
  d.querySelector('[data-a="ficha"]').onclick = () => { mapa.closePopup(); fichaProgresiva(e.ini); };
  d.querySelector('[data-a="editar"]')?.addEventListener('click', () => { mapa.closePopup(); editarElemento(e); });
  d.querySelector('[data-a="hist"]')?.addEventListener('click', () => { mapa.closePopup(); verHistorialElem(e); });
  return d;
}

// ================= cambios de elementos: mover, agregar, anular (con historial en el servidor) =================
const ESTADOS_ELEM = ['PENDIENTE', 'REPLANTEADO', 'REUBICADO', 'NUEVO', 'EN EJECUCIÓN', 'EJECUTADO', 'OBSERVADO', 'ANULADO'];
const CLASE_ESTADO = { EJECUTADO: 'ok', OBSERVADO: 'mal', ANULADO: 'gris', REUBICADO: 'info', NUEVO: 'info', REPLANTEADO: 'info', 'EN EJECUCIÓN': 'info' };
const etqEstadoElem = (e) => `<span class="etq ${CLASE_ESTADO[e] || ''}">${esc(e || '—')}</span>`;
const ACCION_ELEM = { NUEVO: 'Agregado', MOVIDO: 'Movido', EDITADO: 'Editado', ANULADO: 'Anulado', RESTAURADO: 'Restaurado', EDICION_HOJA: 'Editado en la hoja' };
const numONull = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const igualProg = (a, b) => (a == null ? b == null : b != null && Math.abs(a - b) < 0.005);
const fmtUbic = (ini, fin) => fmtProg(ini) + (fin != null ? ' – ' + fmtProg(fin) : '');
// el elemento ya no está donde decía el expediente
const movido = (e) => e.iniExp != null && (!igualProg(e.iniExp, e.ini) || !igualProg(e.finExp, e.fin) || e.ladoExp !== e.lado);

function leerElementos(filas) {
  return filas.filter((e) => e.CODIGO && e.PROG_INI !== '' && e.PROG_INI != null).map((e) => ({
    codigo: String(e.CODIGO), tipo: String(e.TIPO || 'OTR'), ini: +e.PROG_INI, fin: numONull(e.PROG_FIN),
    lado: String(e.LADO || '').toUpperCase(), desc: String(e.DESCRIPCION || nombreTipo(e.TIPO)),
    estado: String(e.ESTADO || 'PENDIENTE'), obs: e.OBS, origen: e.ORIGEN || '',
    iniExp: numONull(e.PROG_INI_EXP), finExp: numONull(e.PROG_FIN_EXP), ladoExp: String(e.LADO_EXP || '').toUpperCase(),
    actualizado: e.ACTUALIZADO || '', actualizadoPor: e.ACTUALIZADO_POR || '', pendiente: !!e._pend,
  })).sort((a, b) => a.ini - b.ini);
}

// Cambios hechos en el teléfono que aún no llegan al servidor: se ven como si ya estuvieran guardados
function conPendientes(filas, pend) {
  if (!pend?.length) return filas;
  const out = filas.map((f) => ({ ...f }));
  for (const d of pend) {
    let f = out.find((x) => String(x.CODIGO).toUpperCase() === d.codigo);
    if (!f) { if (!d.nuevo) continue; f = { CODIGO: d.codigo, ORIGEN: 'NUEVO' }; out.push(f); }
    const movio = !d.nuevo && (!igualProg(numONull(f.PROG_INI), d.ini) || !igualProg(numONull(f.PROG_FIN), d.fin) || String(f.LADO || '').toUpperCase() !== d.lado);
    if (movio && numONull(f.PROG_INI_EXP) == null && f.ORIGEN !== 'NUEVO') Object.assign(f, { PROG_INI_EXP: f.PROG_INI, PROG_FIN_EXP: f.PROG_FIN, LADO_EXP: f.LADO });
    Object.assign(f, { TIPO: d.tipo, PROG_INI: d.ini, PROG_FIN: d.fin ?? '', LADO: d.lado, DESCRIPCION: d.desc, ESTADO: d.estado, OBS: d.obs,
      ACTUALIZADO: new Date(d.t || Date.now()).toISOString(), ACTUALIZADO_POR: S.ajustes.nombre || S.sesion?.nombre || '', _pend: true });
  }
  return out;
}

// Guarda el cambio: en un proyecto con servidor queda en cola y se envía (también sin señal, más tarde)
async function guardarCambioElemento(d) {
  const p = proyActual();
  if (!p.url) {
    // proyecto de archivo: el cambio queda solo en este teléfono
    S.datos.elementos = conPendientes(S.datos.elementos || [], [d]).map(({ _pend, ...f }) => f);
    await kv.set('datos:' + p.id, S.datos);
    aplicarDatos(S.datos);
    return mostrarAviso('Cambio guardado en este teléfono', 'info');
  }
  S.elemPend.push({ ...d, t: Date.now() });
  await kv.set('elem_pend:' + p.id, S.elemPend);
  aplicarDatos(S.datos);
  mostrarAviso(navigator.onLine ? 'Cambio guardado. Enviando…' : 'Cambio guardado en el teléfono. Se enviará cuando haya señal.', 'info');
  await sincronizar();
}

// Pantalla para editar, mover o anular un elemento, o agregar uno nuevo.
// f trae el formulario a medio llenar al volver de elegir un punto en el mapa.
function editarElemento(e = null, pre = {}, f = null) {
  if (!S.eje) return;
  if (!puede('tecnico')) return mostrarAviso('Tu rol no permite cambiar elementos. Pídelo al administrador.');
  const nuevo = !e;
  const siguiente = (t) => { let n = 1; while (S.elementos.some((x) => x.codigo === `${t}-N${String(n).padStart(2, '0')}`)) n++; return `${t}-N${String(n).padStart(2, '0')}`; };
  const tipo0 = e?.tipo || pre.tipo || 'ALC';
  f = f || {
    codigo: e?.codigo || siguiente(tipo0), tipo: tipo0, ini: e?.ini ?? Math.round(pre.prog ?? 0), fin: e?.fin ?? null,
    lado: e?.lado ?? pre.lado ?? '', desc: e?.desc || '', estado: e?.estado || 'NUEVO', obs: e?.obs || '', motivo: '', documento: '', estadoTocado: false,
  };
  const tipos = [...new Set([...Object.keys(S.tipos), ...Object.keys(TIPOS_BASE)])];
  const actual = e ? `Ahora: Km ${fmtUbic(e.ini, e.fin)}${e.lado ? ' ' + e.lado : ''}` : '';
  const exp = e && movido(e) ? ` · en el expediente: Km ${fmtUbic(e.iniExp, e.finExp)}${e.ladoExp ? ' ' + e.ladoExp : ''}` : '';
  const c = hoja(nuevo ? 'Nuevo elemento' : `Editar ${e.codigo}`, `
    ${nuevo ? `<label class="campo" for="ee-cod">Código</label><input id="ee-cod" type="text" value="${esc(f.codigo)}" autocapitalize="characters" maxlength="30">
      <p class="ayuda">Propuesto como TIPO-N01; puedes poner el código del replanteo.</p>` : ''}
    <label class="campo" for="ee-tipo">Tipo</label>
    <select id="ee-tipo">${tipos.map((t) => `<option value="${esc(t)}" ${t === f.tipo ? 'selected' : ''}>${esc(nombreTipo(t))}</option>`).join('')}</select>
    <label class="campo">Ubicación</label>
    ${e ? `<p class="ayuda" style="margin-top:0">${esc(actual + exp)}</p>` : ''}
    <div class="fila"><div class="crece"><span class="ayuda">Progresiva${f.fin != null ? ' de inicio' : ''}</span><input id="ee-ini" type="text" inputmode="decimal" value="${fmtProg(f.ini, 1)}"></div>
      <div class="crece"><span class="ayuda">Fin (solo tramos)</span><input id="ee-fin" type="text" inputmode="decimal" placeholder="—" value="${f.fin != null ? fmtProg(f.fin, 1) : ''}"></div></div>
    <div class="fila" style="margin-top:6px"><span class="ayuda" style="width:46px">Inicio</span><button class="btn crece" data-u="gps-ini">📍 Mi GPS</button><button class="btn crece" data-u="mapa-ini">✛ Mapa</button></div>
    <div class="fila" style="margin-top:6px"><span class="ayuda" style="width:46px">Fin</span><button class="btn crece" data-u="gps-fin">📍 Mi GPS</button><button class="btn crece" data-u="mapa-fin">✛ Mapa</button></div>
    <label class="campo">Lado (según los planos)</label>
    <div class="chips" id="ee-lado">${[['LI', 'Izquierdo (LI)'], ['', 'Eje / ambos'], ['LD', 'Derecho (LD)']].map(([k, t]) => `<button data-l="${k}" class="${f.lado === k ? 'sel' : ''}">${t}</button>`).join('')}</div>
    <label class="campo" for="ee-desc">Descripción</label><input id="ee-desc" type="text" value="${esc(f.desc)}" placeholder="${esc(nombreTipo(f.tipo))}">
    <label class="campo">Estado</label>
    <div class="chips" id="ee-est">${ESTADOS_ELEM.map((k) => `<button data-s="${k}" class="${k === f.estado ? 'sel' : ''}">${k}</button>`).join('')}</div>
    <label class="campo" for="ee-obs">Nota del elemento</label><input id="ee-obs" type="text" value="${esc(f.obs)}">
    <label class="campo" for="ee-mot">Motivo del cambio <span style="color:var(--mal)">*</span></label>
    <textarea id="ee-mot" placeholder="Ej.: en el replanteo el cauce está 20 m antes">${esc(f.motivo)}</textarea>
    <label class="campo" for="ee-doc">Documento de sustento</label>
    <input id="ee-doc" type="text" value="${esc(f.documento)}" placeholder="Asiento N°, carta, consulta, plano…">
    <p class="ayuda">El cambio queda en el historial del elemento con tu nombre, la fecha, el motivo y el documento.${e && !movido(e) && e.origen !== 'NUEVO' ? ' Si lo mueves, se guarda su ubicación del expediente.' : ''}</p>
    <div class="botones"><button class="btn" id="ee-cancel">Cancelar</button><button class="btn primario" id="ee-ok">Guardar</button></div>
    ${!nuevo && f.estado !== 'ANULADO' ? '<button class="btn peligro" id="ee-anular" style="width:100%;margin-top:8px">Anular elemento</button>' : ''}`);

  const leer = () => {
    if (nuevo) f.codigo = c.querySelector('#ee-cod').value.trim().toUpperCase();
    f.tipo = c.querySelector('#ee-tipo').value;
    const ini = parseProg(c.querySelector('#ee-ini').value), finTxt = c.querySelector('#ee-fin').value.trim();
    if (ini != null) f.ini = ini;
    f.fin = finTxt ? parseProg(finTxt) ?? f.fin : null;
    f.desc = c.querySelector('#ee-desc').value.trim();
    f.obs = c.querySelector('#ee-obs').value.trim();
    f.motivo = c.querySelector('#ee-mot').value.trim();
    f.documento = c.querySelector('#ee-doc').value.trim();
  };
  // al mover un elemento del expediente se propone el estado REUBICADO
  const proponerEstado = () => {
    if (!e || f.estadoTocado || !['PENDIENTE', 'REPLANTEADO'].includes(e.estado)) return;
    const cambia = !igualProg(f.ini, e.ini) || !igualProg(f.fin, e.fin) || f.lado !== e.lado;
    f.estado = cambia ? 'REUBICADO' : e.estado;
    c.querySelectorAll('#ee-est button').forEach((b) => b.classList.toggle('sel', b.dataset.s === f.estado));
  };
  const ponerUbic = (cual, u) => {
    const p = Math.round(u.prog * 10) / 10;
    if (cual === 'ini') { f.ini = p; c.querySelector('#ee-ini').value = fmtProg(p, 1); if (f.lado && Math.abs(u.off) > 1.5) f.lado = u.off < 0 ? 'LI' : 'LD'; }
    else { f.fin = p; c.querySelector('#ee-fin').value = fmtProg(p, 1); }
    c.querySelectorAll('#ee-lado button').forEach((b) => b.classList.toggle('sel', b.dataset.l === f.lado));
    proponerEstado();
  };
  c.querySelector('#ee-tipo').onchange = () => { if (nuevo) { const t = c.querySelector('#ee-tipo').value; if (/-N\d\d$/.test(c.querySelector('#ee-cod').value)) c.querySelector('#ee-cod').value = siguiente(t); } };
  c.querySelector('#ee-ini').onchange = () => { leer(); proponerEstado(); };
  c.querySelector('#ee-fin').onchange = () => { leer(); proponerEstado(); };
  c.querySelectorAll('#ee-lado button').forEach((b) => b.onclick = () => {
    f.lado = b.dataset.l; c.querySelectorAll('#ee-lado button').forEach((x) => x.classList.toggle('sel', x === b)); proponerEstado();
  });
  c.querySelectorAll('#ee-est button').forEach((b) => b.onclick = () => {
    f.estado = b.dataset.s; f.estadoTocado = true; c.querySelectorAll('#ee-est button').forEach((x) => x.classList.toggle('sel', x === b));
  });
  c.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => {
    const [como, cual] = b.dataset.u.split('-');
    leer();
    if (como === 'mapa') {
      cerrarHoja();
      return elegirEnMapa(`Mueve el mapa hasta poner la mira + en el ${cual === 'ini' ? 'inicio' : 'fin'} de ${f.codigo}`, (u) => {
        editarElemento(e, pre, f);
        if (u) ponerUbic(cual, u);
      }, e ? (cual === 'fin' && e.fin != null ? e.fin : e.ini) : f.ini);
    }
    // GPS: la posición del recorrido si es reciente; si no, se pide una nueva
    if (S.pos && !S.pos.simulada && Date.now() - S.pos.t < 15000 && S.u) return ponerUbic(cual, S.u);
    mostrarAviso('Buscando tu posición GPS…', 'info');
    navigator.geolocation.getCurrentPosition((p) => {
      $('#aviso').classList.add('oculto');
      const u = ubicarLatLon(p.coords.latitude, p.coords.longitude);
      if (u.dist > 200) return mostrarAviso(`Estás a ${Math.round(u.dist)} m del eje: acércate al elemento`);
      ponerUbic(cual, u);
    }, () => mostrarAviso('No se pudo obtener la posición GPS'), { enableHighAccuracy: true, timeout: 20000 });
  });
  c.querySelector('#ee-cancel').onclick = cerrarHoja;

  const guardar = async (anular = false) => {
    leer();
    if (anular) f.estado = 'ANULADO';
    if (nuevo && !/^[A-Z0-9][\w.+-]{0,29}$/.test(f.codigo)) return mostrarAviso('Código no válido: usa letras, números y guiones');
    if (nuevo && S.elementos.some((x) => x.codigo.toUpperCase() === f.codigo)) return mostrarAviso(`Ya existe el elemento ${f.codigo}`);
    if (f.ini == null || isNaN(f.ini)) return mostrarAviso('Progresiva no válida');
    if (f.ini < S.eje.inicio - 50 || f.ini > S.eje.fin + 50) return mostrarAviso(`La progresiva está fuera de la vía (${fmtProg(S.eje.inicio)} a ${fmtProg(S.eje.fin)})`);
    if (f.fin != null && igualProg(f.fin, f.ini)) f.fin = null;
    if (!f.motivo) { c.querySelector('#ee-mot').focus(); return mostrarAviso('Escribe el motivo del cambio'); }
    if (anular && !confirm(`¿Anular ${f.codigo}? Se verá en gris y ya no se avisará en el recorrido. Queda en el historial y se puede restaurar.`)) return;
    cerrarHoja();
    await guardarCambioElemento({
      codigo: f.codigo.toUpperCase(), nuevo, tipo: f.tipo, ini: Math.round(f.ini * 100) / 100, fin: f.fin == null ? null : Math.round(f.fin * 100) / 100,
      lado: f.lado, desc: f.desc || nombreTipo(f.tipo), estado: f.estado, obs: f.obs, motivo: f.motivo, documento: f.documento,
    });
  };
  c.querySelector('#ee-ok').onclick = () => guardar(false);
  c.querySelector('#ee-anular')?.addEventListener('click', () => guardar(true));
}

// Deja ver el mapa para elegir un punto con la mira +; al aceptar devuelve la progresiva y el lado
function elegirEnMapa(texto, alTerminar, cerca = null) {
  setSeguir(false);
  if (cerca != null) mapa.setView(S.eje.puntoLatLon(cerca), Math.max(mapa.getZoom(), 18));
  document.body.classList.add('eligiendo');
  const b = document.createElement('div');
  b.id = 'elegir';
  b.innerHTML = `<p>${esc(texto)}</p><p class="prog"></p>
    <div class="fila"><button class="btn crece" data-a="no">Cancelar</button><button class="btn primario crece" data-a="si">Aceptar este punto</button></div>`;
  document.body.appendChild(b);
  const leer = () => { const m = mapa.getCenter(), u = ubicarLatLon(m.lat, m.lng); b.querySelector('.prog').textContent = `Mira +: Km ${fmtProg(u.prog, 1)} · ${fmtLadoProg(u.off)}`; };
  mapa.on('move', leer); leer();
  const fin = (u) => { mapa.off('move', leer); b.remove(); document.body.classList.remove('eligiendo'); alTerminar(u); };
  b.querySelector('[data-a="si"]').onclick = () => { const m = mapa.getCenter(); fin(ubicarLatLon(m.lat, m.lng)); };
  b.querySelector('[data-a="no"]').onclick = () => fin(null);
}

async function verHistorialElem(e) {
  const p = proyActual();
  const pend = S.elemPend.filter((d) => d.codigo === e.codigo);
  const expTxt = movido(e) ? `<p class="ayuda">Ubicación del expediente: Km ${fmtUbic(e.iniExp, e.finExp)}${e.ladoExp ? ' ' + e.ladoExp : ''} · ahora: Km ${fmtUbic(e.ini, e.fin)}${e.lado ? ' ' + e.lado : ''}</p>` : '';
  const pendTxt = pend.map((d) => `<div class="hist pend"><b>Por enviar</b> · ${fechaCorta(d.t)}<div class="s">Km ${fmtUbic(d.ini, d.fin)}${d.lado ? ' ' + d.lado : ''} · ${esc(d.estado)}</div><div>Motivo: ${esc(d.motivo)}</div></div>`).join('');
  const c = hoja(`Historial ${e.codigo}`, `${expTxt}${pendTxt}<p class="ayuda">Cargando…</p>`);
  if (!navigator.onLine) { c.lastElementChild.textContent = 'Necesitas internet para ver el historial guardado en el servidor.'; return; }
  try {
    const { cambios } = await api(p, S.sesion).llamar('elem_historial', { codigo: e.codigo });
    c.innerHTML = expTxt + pendTxt + (cambios.map((h) => `<div class="hist"><b>${esc(ACCION_ELEM[h.accion] || h.accion)}</b> · ${fechaCorta(h.fecha)} · ${esc(h.nombre)}
        ${h.antes ? `<div class="s">Antes: ${esc(h.antes)}</div>` : ''}<div class="s">Después: ${esc(h.despues)}</div>
        ${h.motivo ? `<div>Motivo: ${esc(h.motivo)}</div>` : ''}${h.documento ? `<div>Documento: <b>${esc(h.documento)}</b></div>` : ''}</div>`).join('')
      || (pend.length ? '' : '<p class="ayuda">Sin cambios registrados: está como en el expediente.</p>'));
  } catch (er) {
    if (!(await manejarAcceso(er))) c.lastElementChild.textContent = 'No se pudo cargar el historial: ' + er.message;
  }
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

const imagenDe = (src) => { const i = new Image(); i.src = src; return i; };
const listo = (img) => (img?.complete && img.naturalWidth ? img : null);
// logo para las fotos: el del celular si se cargó; si no, el del proyecto
const logoFotos = () => listo(S.logoLocal) || listo(S.logo);

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

// los anulados no se avisan en el recorrido
function elementosAvisables() {
  const t = S.ajustes.tipos;
  return S.elementos.filter((e) => e.estado !== 'ANULADO' && (!t || t.includes(e.tipo)));
}

function textoProximo(u) {
  const lr = (e) => (e.lado ? ` · <b>a tu ${ladoRel(e.lado)}</b>` : '');
  const dentro = S.elementos.filter((e) => e.estado !== 'ANULADO' && e.fin != null && u.prog >= Math.min(e.ini, e.fin) && u.prog <= Math.max(e.ini, e.fin));
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
  const pend = S.obs.filter((o) => o.sync !== 'ok').length + S.elemPend.length;
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
  S.ejeLL = S.eje ? S.eje.latlngs() : null;
  // logo del supervisor para las fotos (se carga por proyecto desde la página de administración)
  S.logo = datos.logo ? imagenDe(datos.logo) : null;
  S.tipos = {};
  for (const t of datos.tipos || []) S.tipos[t.TIPO] = [t.NOMBRE, t.COLOR || '#757575'];
  S.elementos = leerElementos(conPendientes(datos.elementos || [], S.elemPend));
  S.secciones = leerSecciones(datos.seccionTipica);
  S.puntos = leerPuntos(datos);
  S.laminas = leerLaminas(datos);
  const firma = S.laminas.map((l) => l.clave + '|' + l.actualizado).join(';');
  if (firma !== S.lamFirma) { S.lamFirma = firma; colaLaminas(); }
  dibujarProyecto();
  if (S.eje && S.encuadrar && !S.enVia) mapa.fitBounds(L.latLngBounds(S.ejeLL), { padding: [20, 20] });
  S.encuadrar = false;
  mostrarCentro();
}

async function abrirProyecto(id) {
  detenerSim(false); detenerGPS(); salirDeVia(); ocultarAcceso();
  S.actual = id; await kv.set('actual', id);
  const p = proyActual();
  S.sesion = p.url ? (await kv.get('sesion:' + id)) || null : null;
  vaciarPantalla();
  if (p.url && !S.sesion) { pintarEstado(); return mostrarAcceso('login'); }
  // solicitud aún pendiente: se pregunta al servidor si ya fue autorizada
  if (p.url && S.sesion.estado !== 'AUTORIZADO' && !(await comprobarAcceso())) return;
  S.obs = await obsDB.todas(id);
  S.elemPend = (await kv.get('elem_pend:' + id)) || [];
  // logo cargado en este celular para esta obra (tiene prioridad sobre el del proyecto)
  const ll = await kv.get('logo:' + id);
  S.logoLocal = ll ? imagenDe(ll) : null;
  S.encuadrar = true;
  const cache = await kv.get('datos:' + id);
  if (cache) aplicarDatos(cache);
  pintarEstado();
  if (p.url) await actualizarDatos(!cache);
  iniciarGPS();
}

// Deja el mapa sin datos (al cambiar de proyecto o al perder el acceso)
function vaciarPantalla() {
  Object.values(S.lamURL).forEach((u) => URL.revokeObjectURL(u));
  Object.assign(S, { datos: null, eje: null, ejeLL: null, elementos: [], puntos: [], secciones: [], obs: [], logo: null, logoLocal: null, pendientes: 0,
    laminas: [], lamCache: {}, lamURL: {}, lamFirma: '', elemPend: [] });
  dibujarProyecto();
  $('#btn-menu').dataset.n = '';
}

async function actualizarDatos(forzar = false, avisar = false) {
  const p = proyActual();
  if (!p?.url || !navigator.onLine) { if (avisar) mostrarAviso(p?.url ? 'Sin internet: se usan los datos guardados' : 'Proyecto de archivo: no se actualiza desde internet', 'info'); return; }
  if (!autorizado()) return;
  try {
    const srv = A();
    // rol y solicitudes pendientes al día (el administrador puede haberlos cambiado)
    const yo = await srv.yo();
    S.sesion = { ...S.sesion, rol: yo.rol, nombre: yo.nombre };
    S.pendientes = yo.pendientes || 0;
    $('#btn-menu').dataset.n = S.pendientes || '';
    await kv.set('sesion:' + p.id, S.sesion);
    const v = await srv.version();
    if (forzar || v.version !== S.datos?.version) {
      const d = await srv.proyecto();
      await kv.set('datos:' + p.id, d);
      const habia = !!S.datos;
      aplicarDatos(d);
      if (habia) mostrarAviso('Se actualizaron el eje y los elementos del proyecto', 'info');
    } else if (avisar) mostrarAviso('Los datos ya están al día', 'info');
    // láminas que no se pudieron descargar antes
    if (S.laminas.some((l) => !S.lamCache[l.clave]?.svg)) colaLaminas();
    await sincronizar();
  } catch (e) {
    if (await manejarAcceso(e)) return;
    pintarEstado('No se pudo conectar');
    if (avisar || !S.datos) mostrarAviso('No se pudo conectar con la hoja del proyecto: ' + e.message);
  }
}
setInterval(() => { if (document.visibilityState === 'visible') actualizarDatos(); }, 5 * 60 * 1000);

// ================= acceso: inicio de sesión con Google y autorización del administrador =================
// Respuestas del servidor que cambian el acceso. Devuelve true si se encargó del error.
async function manejarAcceso(e) {
  const id = S.actual;
  if (e?.codigo === 'SESION') {
    await kv.del('sesion:' + id); S.sesion = null; detenerGPS(); salirDeVia(); vaciarPantalla();
    mostrarAcceso('login', e.message); return true;
  }
  if (e?.codigo === 'PENDIENTE') {
    S.sesion = { ...S.sesion, estado: 'PENDIENTE' }; await kv.set('sesion:' + id, S.sesion);
    detenerGPS(); salirDeVia(); vaciarPantalla(); mostrarAcceso('pendiente'); return true;
  }
  if (e?.codigo === 'REVOCADO') { await borrarProyectoLocal(id); mostrarAcceso('revocado'); return true; }
  if (e?.codigo === 'ACTUALIZAR') { mostrarAviso(e.message); return true; }
  return false;
}

// Borra del teléfono los datos de un proyecto: datos, láminas, observaciones, sesión y logo propio
async function borrarProyectoLocal(id, quitarDeLista = false) {
  for (const k of ['datos:', 'laminas:', 'elem_pend:', 'sesion:', 'logo:']) await kv.del(k + id);
  for (const o of await obsDB.todas(id)) await obsDB.borrar(o.id);
  if (S.actual === id) { S.sesion = null; detenerGPS(); detenerSim(false); salirDeVia(); vaciarPantalla(); }
  if (quitarDeLista) { S.proyectos = S.proyectos.filter((x) => x.id !== id); await kv.set('proyectos', S.proyectos); }
}

function ocultarAcceso() { $('#acceso').classList.add('oculto'); }

function mostrarAcceso(modo, mensaje = '') {
  const p = proyActual(), c = $('#acceso-cuerpo');
  $('#acceso').classList.remove('oculto');
  $('#acceso-proyecto').textContent = p?.nombre || '';
  const g = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
  const html = {
    login: `${mensaje ? `<p>${esc(mensaje)}</p>` : ''}
      <p>Los datos de la obra son privados del equipo de supervisión. Inicia sesión con tu cuenta de Google.</p>
      <button class="btn blanco" id="ac-login">${g} Iniciar sesión con Google</button>
      <p class="nota">Si es tu primera vez, tu correo queda como solicitud y el administrador debe autorizarte.</p>`,
    pendiente: `<div class="ok">✓</div><p><b>Solicitud enviada</b></p>
      <p>${esc(S.sesion?.correo || '')}</p>
      <p>El administrador de la supervisión debe autorizar tu acceso. Cuando lo haga, toca «Comprobar».</p>
      <button class="btn blanco" id="ac-comprobar">Comprobar de nuevo</button>
      <button class="btn secundario" id="ac-otra">Usar otra cuenta</button>`,
    revocado: `<p><b>El administrador retiró tu acceso a este proyecto.</b></p>
      <p>Los datos del proyecto se borraron de este teléfono.</p>
      <button class="btn secundario" id="ac-otra">Iniciar sesión con otra cuenta</button>`,
    denegado: `<p><b>Tu cuenta no tiene acceso a este proyecto.</b></p><p>${esc(mensaje)}</p>
      <button class="btn secundario" id="ac-otra">Usar otra cuenta</button>`,
    error: `<p>${esc(mensaje)}</p><button class="btn blanco" id="ac-login">Reintentar</button>`,
  }[modo];
  c.innerHTML = html + (S.proyectos.length > 1 || modo !== 'login' ? '<button class="btn secundario" id="ac-proyectos">Proyectos</button>' : '');
  c.querySelector('#ac-login')?.addEventListener('click', iniciarSesion);
  c.querySelector('#ac-otra')?.addEventListener('click', async () => { await kv.del('sesion:' + S.actual); S.sesion = null; iniciarSesion(); });
  c.querySelector('#ac-comprobar')?.addEventListener('click', async () => {
    if (await comprobarAcceso()) abrirProyecto(S.actual);
  });
  c.querySelector('#ac-proyectos')?.addEventListener('click', pantallaProyectos);
}

// Lleva a la página de Google para elegir la cuenta; al volver, terminarLogin completa el acceso
async function iniciarSesion() {
  const p = proyActual();
  if (!p?.url) return;
  if (!navigator.onLine) return mostrarAviso('Necesitas internet para iniciar sesión');
  try {
    const { clientId } = await api(p).info();
    if (!clientId) return mostrarAcceso('error', 'El administrador aún no configuró el inicio de sesión con Google.');
    const nonce = uid() + uid() + uid();
    await kv.set('login', { proyecto: p.id, nonce, t: Date.now() });
    irAGoogle(clientId, nonce, p.id);
  } catch (e) { mostrarAcceso('error', 'No se pudo conectar con el servidor del proyecto: ' + e.message); }
}

// Completa el inicio de sesión al volver de Google. Si algo falla, el motivo se muestra en la
// pantalla de acceso (y se devuelve 'detener' para no reabrir el proyecto por encima).
async function terminarLogin(regreso) {
  const pend = await kv.get('login');
  await kv.del('login');
  const fallo = async (msg) => {
    S.actual = pend?.proyecto || (await kv.get('actual')) || S.proyectos[0]?.id || null;
    mostrarAcceso('error', msg);
    return 'detener';
  };
  if (!pend) return fallo('El inicio de sesión volvió sin los datos de la solicitud (pudo abrirse en otra ventana). Toca «Reintentar» desde la app.');
  if (pend.proyecto !== regreso.estado) return fallo('El inicio de sesión no corresponde a este proyecto. Toca «Reintentar».');
  if (Date.now() - pend.t > 15 * 60000) return fallo('El inicio de sesión tardó demasiado. Toca «Reintentar».');
  const p = S.proyectos.find((x) => x.id === pend.proyecto);
  if (!p) return fallo('No se encontró el proyecto en este teléfono.');
  await kv.set('actual', p.id);
  if (regreso.error) return fallo(`Google no completó el inicio de sesión (${regreso.error}). Toca «Reintentar».`);
  try {
    const r = await api(p).llamar('login', { id_token: regreso.idToken, nonce: pend.nonce, dispositivo: dispositivo() });
    if (r.sesion) await kv.set('sesion:' + p.id, { token: r.sesion, correo: r.correo, nombre: r.nombre, rol: r.rol, estado: r.estado });
    else { S.actual = p.id; mostrarAcceso('denegado', `${r.correo}: acceso ${String(r.estado).toLowerCase()} por el administrador.`); return 'detener'; }
    if (r.estado === 'AUTORIZADO' && !S.ajustes.nombre) { S.ajustes.nombre = r.nombre; await kv.set('ajustes', S.ajustes); }
  } catch (e) { return fallo('El servidor del proyecto no aceptó el inicio de sesión: ' + e.message); }
}

const dispositivo = () => {
  const ua = navigator.userAgent;
  const so = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Otro';
  return `${so} · ${matchMedia('(display-mode: standalone)').matches ? 'app instalada' : 'navegador'}`;
};

// Pregunta al servidor si la sesión ya está autorizada. Devuelve true si se puede continuar.
async function comprobarAcceso() {
  if (!navigator.onLine) { mostrarAcceso('pendiente'); mostrarAviso('Sin internet: no se pudo comprobar'); return false; }
  try {
    const yo = await A().yo();
    S.sesion = { ...S.sesion, estado: 'AUTORIZADO', rol: yo.rol, nombre: yo.nombre };
    await kv.set('sesion:' + S.actual, S.sesion);
    if (!S.ajustes.nombre) { S.ajustes.nombre = yo.nombre; await kv.set('ajustes', S.ajustes); }
    ocultarAcceso();
    return true;
  } catch (e) {
    if (!(await manejarAcceso(e))) mostrarAcceso('error', 'No se pudo comprobar el acceso: ' + e.message);
    return false;
  }
}

async function cerrarSesion() {
  const pend = S.obs.filter((o) => o.sync !== 'ok').length + S.elemPend.length;
  const msg = pend ? `Tienes ${pend} observaciones o cambios de elementos sin enviar: se perderán.\n\n¿Cerrar sesión igual?`
    : 'Al cerrar sesión se borran de este teléfono los datos del proyecto (se vuelven a descargar al entrar).\n\n¿Continuar?';
  if (!confirm(msg)) return;
  cerrarHoja();
  try { await A().llamar('salir'); } catch { /* sin señal: la sesión vence sola */ }
  await borrarProyectoLocal(S.actual);
  mostrarAcceso('login');
}

// En Android, Google puede abrir el inicio de sesión en otra ventana: al volver, se retoma
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.actual || $('#acceso').classList.contains('oculto') || S.sesion) return;
  if (await kv.get('sesion:' + S.actual)) abrirProyecto(S.actual);
});

let sincronizando = false;
async function sincronizar() {
  const p = proyActual();
  if (!p?.url || !navigator.onLine || sincronizando || !autorizado()) return;
  sincronizando = true;
  try {
    const A = api(p, S.sesion);
    // cambios de elementos hechos en el teléfono, en el orden en que se hicieron
    let enviados = 0, rechazados = 0;
    while (S.elemPend.length) {
      const { t: _t, ...d } = S.elemPend[0];
      try { await A.enviar('elemento_guardar', d); enviados++; } catch (e) {
        // sin señal o sin acceso: queda en cola; si el servidor lo rechaza (dato no válido), se avisa y se descarta
        if (!(e instanceof ErrorServidor) || ['SESION', 'PENDIENTE', 'REVOCADO', 'ACTUALIZAR'].includes(e.codigo)) throw e;
        rechazados++;
        mostrarAviso(`No se guardó el cambio de ${d.codigo}: ${e.message}`);
      }
      S.elemPend.shift();
      await kv.set('elem_pend:' + p.id, S.elemPend);
    }
    if (enviados) {
      const datos = await A.proyecto();
      await kv.set('datos:' + p.id, datos);
      aplicarDatos(datos);
      if (!rechazados) mostrarAviso(enviados > 1 ? `${enviados} cambios de elementos guardados` : 'Cambio del elemento guardado', 'info');
    } else if (rechazados) aplicarDatos(S.datos);
    for (const o of S.obs.filter((x) => x.sync !== 'ok')) {
      const { fotos: _, ...resto } = o;
      const obs = { ...resto, fotos: undefined };
      // las fotos van de a una (son pesadas): si se corta la señal, lo enviado no se repite
      const porEnviar = (o.fotos || []).filter((f) => f.datos && !f.url);
      if (!porEnviar.length) await A.enviar('obs_guardar', { obs, fotos: [] });
      for (const f of porEnviar) {
        const r = await A.enviar('obs_guardar', { obs, fotos: [{ id: f.id, nombre: f.nombre, datos: f.datos.split(',')[1] }] });
        if (r.fotos?.[f.id]) { f.url = r.fotos[f.id]; delete f.datos; }
        await obsDB.guardar(o);
      }
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
    sincronizando = false;
    if (await manejarAcceso(e)) return;
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
  const remoto = !!proyActual()?.url, admin = remoto && S.sesion?.rol === 'admin';
  const pend = remoto ? S.obs.filter((o) => o.sync !== 'ok').length : 0;
  const c = hoja('Menú', `${remoto && S.sesion ? `<div class="usuario-menu"><span style="font-size:26px">👤</span>
      <span><b>${esc(S.sesion.nombre)}</b> · ${esc(ROL_NOMBRE[S.sesion.rol] || S.sesion.rol)}<br><span class="s">${esc(S.sesion.correo)}</span></span></div>` : ''}
    <div class="lista-menu">
    ${admin ? `<button data-a="usuarios"><span class="ic">👥</span>Usuarios y permisos${S.pendientes ? `<span class="nota" style="color:var(--mal);font-weight:700">${S.pendientes} por autorizar</span>` : ''}</button>
    <button data-a="datos"><span class="ic">🛠️</span>Datos del proyecto<span class="nota">eje, elementos, logo</span></button>` : ''}
    <button data-a="buscar"><span class="ic">🔎</span>Ir a una progresiva</button>
    <button data-a="ficha"><span class="ic">📋</span>Ficha de esta progresiva<span class="nota">sección y paquete</span></button>
    <button data-a="puntos"><span class="ic">📍</span>Puntos de control<span class="nota">${S.puntos.length}</span></button>
    <button data-a="elementos"><span class="ic">🧱</span>Elementos de obra<span class="nota">${S.elementos.length}</span></button>
    <button data-a="obs"><span class="ic">📝</span>Observaciones<span class="nota">${S.obs.filter((o) => o.estado !== 'ANULADA').length}${pend ? ` · ${pend} por enviar` : ''}</span></button>
    <button data-a="gps"><span class="ic">${S.pausado ? '▶️' : '⏸️'}</span>${S.pausado ? 'Reanudar GPS' : 'Pausar GPS (ahorrar batería)'}</button>
    <button data-a="proyectos"><span class="ic">📁</span>Proyectos<span class="nota">${esc(proyActual()?.nombre || 'ninguno')}</span></button>
    <button data-a="actualizar"><span class="ic">🔄</span>Actualizar datos ahora</button>
    <button data-a="ajustes"><span class="ic">⚙️</span>Ajustes y avisos</button>
    <button data-a="sello"><span class="ic">📷</span>Sello de las fotos</button>
    <button data-a="demo"><span class="ic">🚶</span>Modo demostración${S.sim ? '<span class="nota">en curso</span>' : ''}</button>
    <button data-a="ayuda"><span class="ic">❓</span>Cómo se usa</button>
    ${remoto && S.sesion ? '<button data-a="salir"><span class="ic">🔒</span>Cerrar sesión</button>' : ''}
  </div><p class="ayuda" style="text-align:center;margin-top:14px">Recorrido de Obra v${VERSION_APP}</p>`);
  c.querySelectorAll('.lista-menu button').forEach((b) => b.onclick = () => ({
    buscar: pantallaBuscar, elementos: pantallaElementos, obs: pantallaObs, proyectos: pantallaProyectos,
    gps: () => { cerrarHoja(); pausarGPS(!S.pausado); },
    actualizar: () => { cerrarHoja(); actualizarDatos(true, true); }, ajustes: pantallaAjustes, sello: pantallaSello, demo: pantallaDemo, ayuda: pantallaAyuda,
    usuarios: pantallaUsuarios, datos: () => { location.href = 'admin.html'; }, salir: cerrarSesion,
    ficha: fichaAqui, puntos: pantallaPuntos,
  })[b.dataset.a]());
}

// Ficha en tu posición (en la vía) o en el centro del mapa (mira +)
function fichaAqui() {
  if (!S.eje) return;
  if (S.enVia && S.u) return fichaProgresiva(S.u.prog);
  const c = mapa.getCenter(), u = ubicarLatLon(c.lat, c.lng);
  if (u.dist > 500) return mostrarAviso('Acerca el centro del mapa (mira +) a la vía o busca una progresiva');
  fichaProgresiva(u.prog);
}
$('#prog').addEventListener('click', fichaAqui);

// ---- usuarios y permisos (solo administrador) ----
const fechaCorta = (v) => (v ? new Date(v).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

async function pantallaUsuarios() {
  const c = hoja('Usuarios y permisos', '<p class="ayuda">Cargando…</p>');
  let lista;
  try { lista = (await A().llamar('usuarios')).usuarios; } catch (e) {
    if (!(await manejarAcceso(e))) c.innerHTML = `<p class="ayuda">No se pudo cargar: ${esc(e.message)}</p>`;
    return;
  }
  S.pendientes = lista.filter((u) => u.estado === 'PENDIENTE').length;
  $('#btn-menu').dataset.n = S.pendientes || '';
  const roles = (sel) => Object.entries(ROL_NOMBRE).filter(([k]) => k !== 'admin')
    .map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t}</option>`).join('');
  const fila = (u) => `<div class="usuario-fila" data-c="${esc(u.correo)}">
    <div class="t">${esc(u.nombre || u.correo)}${u.principal ? ' <span class="etq ok">administrador principal</span>' : ''}</div>
    <div class="s">${esc(u.correo)}</div>
    <div class="s">${u.estado === 'PENDIENTE' ? `Solicitó acceso: ${fechaCorta(u.solicitado)}` : `Último acceso: ${fechaCorta(u.ultimoAcceso)}`}</div>
    ${u.principal ? '' : {
      PENDIENTE: `<div class="fila"><select data-rol>${roles('campo')}</select><button class="btn primario" data-est="AUTORIZADO">Autorizar</button><button class="btn peligro" data-est="RECHAZADO">Rechazar</button></div>`,
      AUTORIZADO: `<div class="fila"><select data-rol data-cambia>${roles(u.rol)}</select><button class="btn peligro" data-est="DESACTIVADO">Desactivar</button></div>`,
      DESACTIVADO: `<div class="fila"><select data-rol>${roles(u.rol)}</select><button class="btn" data-est="AUTORIZADO">Reactivar</button></div>`,
      RECHAZADO: `<div class="fila"><select data-rol>${roles(u.rol)}</select><button class="btn" data-est="AUTORIZADO">Autorizar</button></div>`,
    }[u.estado] || ''}</div>`;
  const grupo = (est, titulo) => {
    const g = lista.filter((u) => u.estado === est);
    return g.length ? `<h3 class="grupo-usuarios">${titulo} (${g.length})</h3>${g.map(fila).join('')}` : '';
  };
  c.innerHTML = `<p class="ayuda">Quien abre la app e inicia sesión por primera vez aparece aquí como solicitud.
      <b>Campo</b>: mapa, recorrido y observaciones · <b>Técnico</b>: + secciones y metrados · <b>Acceso total</b>: toda la información.</p>
    ${grupo('PENDIENTE', 'Solicitudes por autorizar') || '<p class="ayuda">No hay solicitudes pendientes.</p>'}
    ${grupo('AUTORIZADO', 'Autorizados')}${grupo('DESACTIVADO', 'Desactivados')}${grupo('RECHAZADO', 'Rechazados')}
    <div class="botones"><button class="btn" id="u-registro">Registro de accesos</button><button class="btn peligro" id="u-cerrar">Cerrar todas las sesiones</button></div>`;

  const actualizar = async (correo, estado, rol) => {
    try {
      await A().llamar('usuario_actualizar', { correo, estado, rol });
      mostrarAviso(estado === 'AUTORIZADO' ? 'Acceso autorizado' : estado ? 'Acceso actualizado' : 'Rol actualizado', 'info');
    } catch (e) { if (!(await manejarAcceso(e))) mostrarAviso('No se pudo actualizar: ' + e.message); }
    pantallaUsuarios();
  };
  c.querySelectorAll('.usuario-fila[data-c]').forEach((f) => {
    const correo = f.dataset.c, sel = f.querySelector('[data-rol]');
    f.querySelectorAll('[data-est]').forEach((b) => b.onclick = () => {
      const est = b.dataset.est;
      if ((est === 'DESACTIVADO' || est === 'RECHAZADO') && !confirm(`¿${est === 'DESACTIVADO' ? 'Desactivar' : 'Rechazar'} a ${correo}?\n\nPierde el acceso y, en su próxima conexión, se borran los datos de su teléfono.`)) return;
      actualizar(correo, est, sel?.value);
    });
    if (sel?.dataset.cambia !== undefined) sel.onchange = () => actualizar(correo, '', sel.value);
  });
  c.querySelector('#u-registro').onclick = pantallaRegistro;
  c.querySelector('#u-cerrar').onclick = async () => {
    if (!confirm('Se cerrarán las sesiones de todos los demás usuarios. Tendrán que volver a iniciar sesión. ¿Continuar?')) return;
    try { const r = await A().llamar('cerrar_sesiones'); mostrarAviso(`Se cerraron ${r.cerradas} sesiones`, 'info'); }
    catch (e) { if (!(await manejarAcceso(e))) mostrarAviso('No se pudo: ' + e.message); }
  };
}

async function pantallaRegistro() {
  const c = hoja('Registro de accesos', '<p class="ayuda">Cargando…</p>', pantallaUsuarios);
  try {
    const { registro } = await A().llamar('registro', { n: 300 });
    c.innerHTML = `<p class="ayuda">Últimos ${registro.length} movimientos (el registro completo está en la hoja REGISTRO).</p>` +
      registro.map((r) => `<div class="registro-fila"><b>${fechaCorta(r.FECHA)}</b> · ${esc(r.CORREO)}<br>${esc(r.ACCION)}${r.DETALLE ? ` <span class="ayuda">${esc(r.DETALLE)}</span>` : ''}</div>`).join('');
  } catch (e) { if (!(await manejarAcceso(e))) c.innerHTML = `<p class="ayuda">No se pudo cargar: ${esc(e.message)}</p>`; }
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
    setSeguir(false);
    mapa.setView(S.eje.puntoLatLon(p), 17);
    fichaProgresiva(p);
  };
  c.querySelector('#b-ir').onclick = ir;
  inp.onkeydown = (e) => { if (e.key === 'Enter') ir(); };
  c.querySelector('#b-cancel').onclick = cerrarHoja;
}

function pantallaElementos() {
  const tipos = [...new Set(S.elementos.map((e) => e.tipo))];
  let filtro = null, vista = '';
  const conCambios = (e) => movido(e) || e.origen === 'NUEVO' || e.pendiente || ['REUBICADO', 'NUEVO', 'ANULADO'].includes(e.estado);
  const n = { cambios: S.elementos.filter(conCambios).length, anulados: S.elementos.filter((e) => e.estado === 'ANULADO').length };
  const c = hoja('Elementos de obra', `
    ${puede('tecnico') ? '<button class="btn primario" id="e-nuevo" style="width:100%;margin-bottom:10px">＋ Nuevo elemento</button>' : ''}
    <input id="e-txt" type="search" placeholder="Buscar código o descripción">
    <div class="chips" id="e-vista" style="margin-top:10px"><button data-v="" class="sel">Todos</button>
      <button data-v="cambios">Con cambios (${n.cambios})</button><button data-v="anulados">Anulados (${n.anulados})</button></div>
    <div class="chips" id="e-tipos" style="margin:10px 0"><button data-t="" class="sel">Todos los tipos</button>${tipos.map((t) => `<button data-t="${esc(t)}">${miniTipo(t, colorTipo(t), 22)}${esc(nombreTipo(t))}</button>`).join('')}</div>
    <div id="e-lista"></div>`);
  const pintar = () => {
    const q = c.querySelector('#e-txt').value.trim().toLowerCase();
    const lst = S.elementos.filter((e) => (!filtro || e.tipo === filtro) && (!q || (e.codigo + ' ' + e.desc).toLowerCase().includes(q))
      && (vista !== 'cambios' || conCambios(e)) && (vista !== 'anulados' || e.estado === 'ANULADO'));
    c.querySelector('#e-lista').innerHTML = lst.slice(0, 400).map((e) => `<button class="item ${e.estado === 'ANULADO' ? 'anulado' : ''}" data-i="${S.elementos.indexOf(e)}">
      ${miniTipo(e.tipo, e.estado === 'ANULADO' ? '#9e9e9e' : colorTipo(e.tipo))}
      <span><span class="t">${esc(e.codigo)}</span><br><span class="s">${esc(e.desc)}${e.obs ? ' · ⚠' : ''}${movido(e) ? ` · expediente: ${fmtProg(e.iniExp)}` : ''}</span></span>
      <span class="der">${fmtProg(e.ini)}${e.fin != null ? '<br><span class="s">a ' + fmtProg(e.fin) + '</span>' : ''}<br>${etqEstadoElem(e.estado)}${e.pendiente ? ' <span class="etq pend">por enviar</span>' : ''}</span></button>`).join('')
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
  c.querySelectorAll('#e-vista button').forEach((b) => b.onclick = () => {
    vista = b.dataset.v;
    c.querySelectorAll('#e-vista button').forEach((x) => x.classList.toggle('sel', x === b));
    pintar();
  });
  c.querySelector('#e-nuevo')?.addEventListener('click', () => {
    // en el punto donde estás (en la vía) o donde mira el mapa
    const m = mapa.getCenter(), u = S.enVia && S.u ? S.u : ubicarLatLon(m.lat, m.lng);
    editarElemento(null, { prog: u.prog });
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

// Texto del sello de las fotos: progresiva, coordenadas, fecha, usuario y obra
// (el lado no va en la foto; queda registrado en la observación)
function lineasSello() {
  const lineas = [];
  if (S.pos && Date.now() - S.pos.t < 20000 && S.u) {
    const [E, N] = latLonAUtm(S.pos.lat, S.pos.lon, S.eje.zona, S.eje.sur);
    lineas.push(S.u.dist <= EN_VIA_M ? `Km ${fmtProg(S.u.prog, 1)}` : `Fuera de la vía · ${(S.u.dist / 1000).toFixed(1)} km del eje`);
    lineas.push(`${S.pos.lat.toFixed(6)}, ${S.pos.lon.toFixed(6)}${S.pos.simulada ? ' (simulación)' : ''}`);
    lineas.push(`E ${E.toFixed(1)}  N ${N.toFixed(1)}`);
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
    c.querySelector('#f-fotos').innerHTML = o.fotos.map((f, i) => `<div>${f.mini ? `<img src="${f.mini}" alt="Foto ${i + 1}" data-v="${i}">` : `<a href="#" data-v="${i}">Ver foto ${i + 1}</a>`}${!f.url ? `<button data-i="${i}" aria-label="Quitar">✕</button>` : ''}</div>`).join('');
    c.querySelectorAll('#f-fotos [data-i]').forEach((b) => b.onclick = () => { o.fotos.splice(+b.dataset.i, 1); pintarFotos(); });
    c.querySelectorAll('#f-fotos [data-v]').forEach((im) => im.onclick = (ev) => { ev.preventDefault(); verFoto(o.fotos[+im.dataset.v]); });
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
    // posición y eje para el minimapa (sin GPS reciente no se dibuja)
    contexto: () => (S.pos && Date.now() - S.pos.t < 20000 ? { lat: S.pos.lat, lon: S.pos.lon, eje: S.ejeLL } : null),
    opciones: {
      logo: S.ajustes.fotoLogo ? logoFotos() : null,
      mapa: S.ajustes.fotoMapa, brujula: S.ajustes.fotoBrujula, estilo: S.ajustes.estiloFoto,
    },
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

// Foto a tamaño completo. Si ya se envió, el teléfono solo guarda la miniatura: la original se pide
// al servidor del proyecto (solo usuarios autorizados; la carpeta de Drive no se comparte con nadie).
async function verFoto(f) {
  let datos = f.datos;
  if (!datos && f.url) {
    const id = (String(f.url).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id || !proyActual()?.url) return mostrarAviso('Esta foto no está disponible');
    if (!navigator.onLine) return mostrarAviso('Sin internet: la foto original está en el servidor del proyecto');
    mostrarAviso('Descargando la foto…', 'info');
    try {
      const r = await A().llamar('foto', { id });
      datos = `data:${r.tipo};base64,${r.datos}`;
      f.nombre = f.nombre || r.nombre;
    } catch (e) { if (!(await manejarAcceso(e))) mostrarAviso('No se pudo descargar la foto: ' + e.message); return; }
    $('#aviso').classList.add('oculto');
  }
  if (!datos) return mostrarAviso('Esta foto no está disponible');
  const v = document.createElement('div');
  v.id = 'visor';
  v.innerHTML = `<img src="${datos}" alt="Foto">
    <div class="visor-barra"><span></span>
      <button class="btn" id="v-guardar">⬇ Guardar en el teléfono</button><button class="btn primario" id="v-cerrar">Cerrar</button></div>`;
  document.body.appendChild(v);
  const img = v.querySelector('img');
  img.onload = () => { v.querySelector('.visor-barra span').textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; };
  v.querySelector('#v-cerrar').onclick = () => v.remove();
  v.querySelector('#v-guardar').onclick = async () => {
    const blob = await (await fetch(datos)).blob();
    const archivo = new File([blob], f.nombre || 'foto.jpg', { type: 'image/jpeg' });
    // en el celular se abre "Compartir" (Guardar imagen / Galería / Drive…); si no, se descarga
    if (navigator.canShare?.({ files: [archivo] })) { await navigator.share({ files: [archivo] }).catch(() => {}); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = archivo.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

function ponerProg(o, prog, off, fuente) {
  const [lat, lon] = S.eje.puntoLatLon(prog, off);
  Object.assign(o, { prog, off, lat, lon, fuente }); delete o.prec;
}

// ---- proyectos ----
function pantallaProyectos() {
  const c = hoja('Proyectos', `
    <div id="p-lista">${S.proyectos.map((p) => `<div class="item"><span class="punto" style="background:${p.id === S.actual ? '#2e7d32' : '#c5ccd3'}"></span>
      <span class="crece"><span class="t">${esc(p.nombre)}</span><br><span class="s">${p.url ? (p.id === S.actual && S.sesion?.correo ? `Sesión: ${esc(S.sesion.correo)}` : 'Servidor de la supervisión (requiere iniciar sesión)') : 'Abierto desde archivo (solo en este teléfono)'}</span></span>
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
    const ses = await kv.get('sesion:' + p.id);
    if (ses && navigator.onLine) { try { await api(p, ses).llamar('salir'); } catch { /* la sesión vence sola */ } }
    const eraActual = S.actual === p.id;
    await borrarProyectoLocal(p.id, true);
    if (eraActual) {
      S.actual = null; ocultarAcceso();
      if (S.proyectos[0]) await abrirProyecto(S.proyectos[0].id); else { cerrarHoja(); return bienvenida(); }
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
  if (p) { p.nombre = d.nombre; delete p.k; }
  else { p = { id: uid(), nombre: d.nombre, url: d.url }; S.proyectos.push(p); }
  await kv.set('proyectos', S.proyectos);
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
    <button class="btn" id="a-sello" style="width:100%;margin-top:16px">📷 Sello de las fotos (logo, brújula, minimapa, transparencia)</button>
    <div class="botones"><button class="btn" id="a-probar">🔊 Probar aviso</button><button class="btn primario" id="a-guardar">Guardar</button></div>`);
  c.querySelector('#a-sello').onclick = pantallaSello;
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

// ---- sello de las fotos: qué se imprime y con qué transparencia, con vista previa en vivo ----
function escenaPrueba(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h * .55);
  g.addColorStop(0, '#8fb9e0'); g.addColorStop(1, '#e9eef2');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#6f8a6a';
  ctx.beginPath(); ctx.moveTo(0, h * .5);
  for (let x = 0; x <= w; x += w / 8) ctx.lineTo(x, h * (.36 + .1 * Math.sin(x / w * 7)));
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
  g = ctx.createLinearGradient(0, h * .5, 0, h);
  g.addColorStop(0, '#4f7a3a'); g.addColorStop(1, '#2f4f22');
  ctx.fillStyle = g; ctx.fillRect(0, h * .52, w, h);
  ctx.fillStyle = '#8d8578';
  ctx.beginPath(); ctx.moveTo(w * .46, h * .52); ctx.lineTo(w * .54, h * .52); ctx.lineTo(w * .95, h); ctx.lineTo(w * .2, h); ctx.fill();
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 ? '#2e5a1f' : '#3d6e2a';
    ctx.beginPath(); ctx.arc((i * 137) % w, h * (.5 + (i % 5) * .03), h * (.05 + (i % 3) * .02), 0, 2 * Math.PI); ctx.fill();
  }
}

function logoEjemplo() {
  const c = document.createElement('canvas'); c.width = 360; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#0f2a3d'; x.beginPath(); x.roundRect?.(10, 10, 140, 140, 24); x.fill();
  x.strokeStyle = '#ffb300'; x.lineWidth = 10; x.beginPath(); x.moveTo(40, 130); x.quadraticCurveTo(80, 40, 120, 30); x.stroke();
  x.fillStyle = '#0f2a3d'; x.font = '800 44px system-ui, sans-serif'; x.fillText('TU LOGO', 165, 95);
  return c;
}

function pantallaSello() {
  const a = S.ajustes, est = { ...ESTILO_BASE, ...a.estiloFoto };
  const on = { logo: a.fotoLogo, brujula: a.fotoBrujula, mapa: a.fotoMapa };
  const barra = (k, t) => `<div class="desliz"><label for="r-${k}">${t}</label><b id="v-${k}">${Math.round(est[k] * 100)} %</b>
    <input type="range" id="r-${k}" min="0" max="100" step="1" value="${Math.round(est[k] * 100)}"></div>`;
  const grupo = (id, titulo, barras, nota = '') => `<div class="grupo-sello${on[id] ? '' : ' apagado'}" id="g-${id}">
    <label class="campo"><input type="checkbox" id="t-${id}" ${on[id] ? 'checked' : ''}> ${titulo}</label>${nota}${barras}</div>`;
  const c = hoja('Sello de las fotos', `
    <div class="prev-sello"><canvas id="s-prev" width="720" height="540"></canvas></div>
    <label class="btn" style="display:flex;align-items:center;justify-content:center;margin-top:8px">🖼 Ver sobre una foto mía<input id="s-foto" type="file" accept="image/*" hidden></label>
    ${grupo('logo', 'Logo', barra('logo', 'Logo') + barra('logoFondo', 'Recuadro blanco'), `
      <p class="ayuda" id="s-logo-estado"></p>
      <div class="fila"><label class="btn crece" style="display:flex;align-items:center;justify-content:center">📁 Cargar logo de mi empresa<input id="s-logo" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
        <button class="btn peligro" id="s-logo-quitar">Quitar</button></div>`)}
    ${grupo('brujula', 'Brújula', barra('brujula', 'Brújula') + barra('brujulaFondo', 'Fondo oscuro'))}
    ${grupo('mapa', 'Minimapa', barra('mapa', 'Minimapa'))}
    <div class="grupo-sello"><label class="campo">Texto</label>${barra('texto', 'Fondo oscuro')}</div>
    <p class="ayuda">0 % = invisible · 100 % = sin transparencia. El ajuste se guarda en este celular.</p>
    <div class="botones"><button class="btn" id="s-reset">Restablecer</button><button class="btn primario" id="s-guardar">Guardar</button></div>`);

  const prev = c.querySelector('#s-prev'), claves = Object.keys(ESTILO_BASE);
  const leer = () => Object.fromEntries(claves.map((k) => [k, +c.querySelector('#r-' + k).value / 100]));
  const activo = (id) => c.querySelector('#t-' + id).checked;
  const ejemplo = logoEjemplo();
  let fondo = null, turno = 0;
  const estadoLogo = () => {
    c.querySelector('#s-logo-estado').textContent = S.logoLocal ? 'Usando el logo cargado en este celular.'
      : S.logo ? 'Usando el logo del proyecto (cargado por el administrador).'
      : 'Aún no hay logo: se muestra uno de ejemplo. Cárgalo aquí o desde la página de administración (para todo el equipo).';
    c.querySelector('#s-logo-quitar').classList.toggle('oculto', !S.logoLocal);
  };
  estadoLogo();

  const pintar = async () => {
    const t = ++turno;
    const cv = document.createElement('canvas'); cv.width = prev.width; cv.height = prev.height;
    const ctx = cv.getContext('2d');
    if (fondo) { // la foto elegida, recortada para llenar el cuadro
      const k = Math.max(cv.width / fondo.naturalWidth, cv.height / fondo.naturalHeight);
      ctx.drawImage(fondo, (cv.width - fondo.naturalWidth * k) / 2, (cv.height - fondo.naturalHeight * k) / 2, fondo.naturalWidth * k, fondo.naturalHeight * k);
    } else escenaPrueba(ctx, cv.width, cv.height);
    const gps = S.pos && Date.now() - S.pos.t < 20000;
    // sin GPS: el punto del eje más cercano al centro del mapa, para que el minimapa muestre la vía
    let centro = gps ? { lat: S.pos.lat, lng: S.pos.lon } : mapa.getCenter();
    if (!gps && S.eje) { const [la, lo] = S.eje.puntoLatLon(ubicarLatLon(centro.lat, centro.lng).prog); centro = { lat: la, lng: lo }; }
    const lineas = gps ? lineasSello() : ['Km 10+337.8', '-5.180723, -78.900982', 'E 732671.9  N 9426973.8',
      `${new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${S.ajustes.nombre || 'Usuario'}`,
      proyActual()?.nombre || 'Obra'];
    await componer(cv, {
      lineas, logo: activo('logo') ? (logoFotos() || ejemplo) : null, rumbo: activo('brujula') ? 245 : null, estilo: leer(),
      mapa: activo('mapa') && S.ejeLL ? { lat: centro.lat, lon: centro.lng, eje: S.ejeLL } : null,
    });
    if (t === turno) prev.getContext('2d').drawImage(cv, 0, 0);
  };

  claves.forEach((k) => c.querySelector('#r-' + k).addEventListener('input', (e) => {
    c.querySelector('#v-' + k).textContent = `${e.target.value} %`;
    pintar();
  }));
  ['logo', 'brujula', 'mapa'].forEach((id) => c.querySelector('#t-' + id).addEventListener('change', (e) => {
    c.querySelector('#g-' + id).classList.toggle('apagado', !e.target.checked);
    pintar();
  }));
  // logo desde el celular: se reduce a 600 px (PNG conserva la transparencia) y se guarda por obra
  c.querySelector('#s-logo').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = URL.createObjectURL(f); });
    e.target.value = '';
    if (!img) return mostrarAviso('No se pudo leer la imagen');
    const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL('image/png');
    await kv.set('logo:' + S.actual, url);
    S.logoLocal = imagenDe(url);
    await S.logoLocal.decode().catch(() => {});
    c.querySelector('#t-logo').checked = true; c.querySelector('#g-logo').classList.remove('apagado');
    estadoLogo(); pintar();
  };
  c.querySelector('#s-logo-quitar').onclick = async () => {
    await kv.del('logo:' + S.actual);
    S.logoLocal = null;
    estadoLogo(); pintar();
  };
  c.querySelector('#s-foto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    fondo = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = URL.createObjectURL(f); });
    pintar();
  };
  c.querySelector('#s-reset').onclick = () => {
    claves.forEach((k) => { c.querySelector('#r-' + k).value = Math.round(ESTILO_BASE[k] * 100); c.querySelector('#v-' + k).textContent = `${Math.round(ESTILO_BASE[k] * 100)} %`; });
    ['logo', 'brujula', 'mapa'].forEach((id) => { c.querySelector('#t-' + id).checked = true; c.querySelector('#g-' + id).classList.remove('apagado'); });
    pintar();
  };
  c.querySelector('#s-guardar').onclick = async () => {
    Object.assign(S.ajustes, { estiloFoto: leer(), fotoLogo: activo('logo'), fotoBrujula: activo('brujula'), fotoMapa: activo('mapa') });
    await kv.set('ajustes', S.ajustes);
    cerrarHoja(); mostrarAviso('Sello de las fotos guardado', 'info');
  };
  pintar();
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
      <li>En el mapa: cuadros de color = elementos de obra (cada tipo con su dibujo), flecha azul = tú, gota = observación, triángulo negro = BM, triángulo azul = punto geodésico (rojo si está observado).</li>
      <li>Técnicos y administrador: en el elemento, <b>✎ Editar / mover</b> para cambiar su progresiva o lado (con tu GPS o la mira del mapa), su estado o anularlo; en ☰ → Elementos de obra, <b>＋ Nuevo elemento</b>. Cada cambio pide el motivo y el documento y queda en el <b>historial</b>; la ubicación del expediente se ve como un punto gris.</li>
      <li>Toca la vía o la progresiva de arriba para abrir la <b>ficha de esa progresiva</b>: curva, láminas de la sección típica del plano (tócalas para ampliar), paquete estructural, elementos, puntos de control y observaciones cercanas.</li>
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
  // la dirección puede traer: el regreso de Google (#id_token=…), un enlace de proyecto (#p=…) o un archivo
  const regreso = leerRegreso(location.hash);
  const inv = leerEnlace(location.hash);
  const archivo = location.hash.match(/#archivo=(.+)$/);
  history.replaceState(null, '', location.pathname + location.search); // el token no queda en la dirección
  if (regreso) {
    const r = await terminarLogin(regreso);
    const act = await kv.get('actual');
    if (r !== 'detener' && S.proyectos.some((p) => p.id === act)) await abrirProyecto(act);
  } else if (inv) {
    await agregarProyecto(inv);
  } else if (archivo) {
    try { await agregarArchivo(await (await fetch(decodeURIComponent(archivo[1]))).json()); } catch { mostrarAviso('No se pudo abrir el archivo del proyecto'); }
  } else {
    const act = await kv.get('actual');
    const id = S.proyectos.some((p) => p.id === act) ? act : S.proyectos[0]?.id;
    if (id) await abrirProyecto(id);
  }
  if (!S.proyectos.length) bienvenida();
  else if (!S.ajustes.nombre && autorizado() && $('#acceso').classList.contains('oculto')) pantallaNombre();
  pintarEstado();
}
arrancar();
window.__recorrido = { S, alPosicion, iniciarSim, detenerSim, pausarGPS, sincronizar, abrirProyecto, fichaProgresiva };
