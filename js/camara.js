// Cámara de obra: vista en vivo y foto con un sello impreso en la imagen, al estilo de las
// apps de cámara GPS pero con la progresiva del proyecto:
//   arriba a la izquierda   logo del supervisor (se configura por proyecto)
//   arriba a la derecha     brújula con la aguja hacia donde apunta la cámara
//   abajo a la izquierda    minimapa satelital con el eje y tu posición
//   abajo a la derecha      progresiva, coordenadas, fecha, usuario y obra
// Si el teléfono no deja abrir la cámara dentro de la app, la "Cámara del teléfono" también
// sirve: a esa foto se le imprime el mismo sello.
//
// La app está fijada en vertical, así que la cámara entrega siempre un cuadro vertical.
// Con el sensor de orientación se sabe si el teléfono está en horizontal y la foto se gira
// para que quede horizontal y con el sello derecho.

const LADO_MAX = 4096; // lado mayor de la foto guardada (≈12 MP en 4:3)
const CALIDAD_JPEG = .9;
const RAD = Math.PI / 180;

// Opacidad de cada elemento del sello (0 a 1). El usuario la ajusta en "Sello de las fotos".
export const ESTILO_BASE = { logo: 1, logoFondo: .82, brujula: 1, brujulaFondo: .5, mapa: 1, texto: .58 };

// Dibuja un elemento en un lienzo aparte y lo pega con la opacidad pedida,
// para que todo el elemento (no cada trazo por separado) quede translúcido
async function capa(ctx, x, y, w, h, op, dibujar) {
  if (op <= 0) return;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  await dibujar(c.getContext('2d'));
  ctx.save(); ctx.globalAlpha = Math.min(1, op);
  ctx.drawImage(c, x, y);
  ctx.restore();
}
const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ================= composición de la foto =================

// Texto abajo a la derecha; la primera línea (progresiva) va resaltada.
// "reserva" es el ancho ocupado a la izquierda por el minimapa.
function dibujarTexto(ctx, w, h, lineas, margen, reserva, fondo = ESTILO_BASE.texto) {
  const m = Math.min(w, h);
  let fs = Math.max(14, Math.round(m / 30));
  const medir = () => {
    const fsT = Math.round(fs * 1.3), pad = Math.round(fs * .7);
    let ancho = 0;
    lineas.forEach((l, i) => { ctx.font = `${i ? 600 : 800} ${i ? fs : fsT}px ${FUENTE}`; ancho = Math.max(ancho, ctx.measureText(l).width); });
    return { fsT, pad, ancho };
  };
  let d = medir();
  const disponible = w - reserva - 2 * margen;
  if (d.ancho + 2 * d.pad > disponible) { fs = Math.max(12, Math.floor(fs * disponible / (d.ancho + 2 * d.pad))); d = medir(); }
  const { fsT, pad, ancho } = d, lh = Math.round(fs * 1.35);
  const alto = fsT * 1.35 + (lineas.length - 1) * lh + pad * 1.4;
  const bw = Math.min(disponible, ancho + 2 * pad);
  const x = w - margen - bw, y = h - margen - alto;
  if (fondo > 0) { ctx.fillStyle = `rgba(0,0,0,${fondo})`; ctx.fillRect(x, y, bw, alto); }
  ctx.textBaseline = 'top'; ctx.textAlign = 'right';
  let yy = y + pad * .7;
  lineas.forEach((l, i) => {
    ctx.font = `${i ? 600 : 800} ${i ? fs : fsT}px ${FUENTE}`;
    ctx.fillStyle = i ? '#ffffff' : '#ffb300';
    ctx.fillText(l, x + bw - pad, yy, bw - 2 * pad);
    yy += i ? lh : fsT * 1.35;
  });
  ctx.textAlign = 'left';
}

function rectRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Logo arriba a la izquierda, sobre un recuadro blanco (fondo 0 = sin recuadro)
async function dibujarLogo(ctx, logo, margen, m, op, fondo) {
  const alto = m * .17, pad = alto * .1;
  const lw = logo.naturalWidth || logo.width, lh = logo.naturalHeight || logo.height;
  if (!lw || !lh) return;
  let dh = alto, dw = lw / lh * dh;
  if (dw > m * .45) { dw = m * .45; dh = lh / lw * dw; }
  await capa(ctx, margen, margen, dw + 2 * pad, dh + 2 * pad, op, (c) => {
    if (fondo > 0) {
      c.fillStyle = `rgba(255,255,255,${fondo})`;
      rectRedondo(c, 0, 0, dw + 2 * pad, dh + 2 * pad, pad);
      c.fill();
    }
    c.drawImage(logo, pad, pad, dw, dh);
  });
}

// Brújula: dial con N (rojo), E, S, O y una aguja que apunta hacia donde mira la cámara
export function dibujarBrujula(ctx, cx, cy, r, rumbo, fondo = ESTILO_BASE.brujulaFondo) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI);
  if (fondo > 0) { ctx.fillStyle = `rgba(0,0,0,${fondo})`; ctx.fill(); }
  ctx.lineWidth = r * .07; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const a = i * 22.5 * RAD, largo = i % 4 === 0 ? .2 : i % 2 === 0 ? .13 : .07;
    ctx.beginPath();
    ctx.moveTo(Math.sin(a) * r * .88, -Math.cos(a) * r * .88);
    ctx.lineTo(Math.sin(a) * r * (.88 - largo), -Math.cos(a) * r * (.88 - largo));
    ctx.lineWidth = r * (i % 4 === 0 ? .05 : .03); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
  }
  ctx.font = `800 ${Math.round(r * .3)}px ${FUENTE}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['N', 0, '#ff5252'], ['E', 90, '#fff'], ['S', 180, '#fff'], ['O', 270, '#fff']].forEach(([t, a, c]) => {
    ctx.fillStyle = c; ctx.fillText(t, Math.sin(a * RAD) * r * .56, -Math.cos(a * RAD) * r * .56);
  });
  // aguja
  ctx.rotate(rumbo * RAD);
  ctx.beginPath(); ctx.moveTo(0, -r * .8); ctx.lineTo(r * .14, 0); ctx.lineTo(-r * .14, 0); ctx.closePath();
  ctx.fillStyle = '#ffb300'; ctx.fill();
  ctx.lineWidth = r * .025; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, r * .45); ctx.lineTo(r * .11, 0); ctx.lineTo(-r * .11, 0); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * .08, 0, 2 * Math.PI); ctx.fillStyle = '#000'; ctx.fill();
  ctx.restore();
  ctx.textAlign = 'left';
}

// ---- minimapa satelital (teselas de Esri, unos 2 km de ancho) ----
// En fotos grandes se usa zoom 16 (el doble de detalle) para que el minimapa no se vea pixelado.
const VISTA15 = 460; // px del mundo a zoom 15 que cubre el minimapa
const zoomPara = (tam) => (tam > 500 ? 16 : 15);
const teselas = new Map();
function tesela(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (!teselas.has(k)) {
    teselas.set(k, fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, { mode: 'cors' })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null)).catch(() => null));
  }
  return teselas.get(k);
}
const aMundo = (lat, lon, z) => {
  const n = 256 * 2 ** z, s = Math.sin(lat * RAD);
  return [(lon + 180) / 360 * n, (.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};
function teselasDe(lat, lon, z) {
  const vista = VISTA15 * 2 ** (z - 15);
  const [cx, cy] = aMundo(lat, lon, z), izq = cx - vista / 2, arr = cy - vista / 2, lista = [];
  for (let tx = Math.floor(izq / 256); tx <= Math.floor((izq + vista) / 256); tx++)
    for (let ty = Math.floor(arr / 256); ty <= Math.floor((arr + vista) / 256); ty++) lista.push([tx, ty]);
  return { izq, arr, lista, vista };
}
// descarga anticipada al abrir la cámara, para que la foto salga al instante
export function precargarMinimapa(lat, lon) {
  for (const z of [15, 16]) teselasDe(lat, lon, z).lista.forEach(([x, y]) => tesela(z, x, y));
}

async function dibujarMinimapa(ctx, x0, y0, tam, { lat, lon, eje, rumbo }) {
  const z = zoomPara(tam), { izq, arr, lista, vista } = teselasDe(lat, lon, z);
  const t = tam / vista; // escala de las teselas
  const s = tam / VISTA15; // unidad para grosores y tamaños (diseño a 460 px)
  const espera = new Promise((r) => setTimeout(() => r(null), 2500));
  const imgs = await Promise.all(lista.map(([x, y]) => Promise.race([tesela(z, x, y), espera])));
  ctx.save();
  rectRedondo(ctx, x0, y0, tam, tam, tam * .05);
  ctx.clip();
  ctx.fillStyle = '#5b6b5a'; ctx.fillRect(x0, y0, tam, tam); // sin señal: fondo liso, el eje se dibuja igual
  lista.forEach(([tx, ty], i) => { if (imgs[i]) ctx.drawImage(imgs[i], x0 + (tx * 256 - izq) * t, y0 + (ty * 256 - arr) * t, 256 * t + .5, 256 * t + .5); });
  // eje de la vía
  if (eje?.length) {
    ctx.beginPath();
    let dentro = false;
    for (const [la, lo] of eje) {
      const [wx, wy] = aMundo(la, lo, z), px = x0 + (wx - izq) * t, py = y0 + (wy - arr) * t;
      const cerca = px > x0 - tam && px < x0 + 2 * tam && py > y0 - tam && py < y0 + 2 * tam;
      if (cerca && dentro) ctx.lineTo(px, py); else if (cerca) ctx.moveTo(px, py);
      dentro = cerca;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6 * s; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
    ctx.lineWidth = 3.5 * s; ctx.strokeStyle = '#ffd54f'; ctx.stroke();
  }
  // posición, con un cono hacia donde mira la cámara
  const cx = x0 + tam / 2, cy = y0 + tam / 2;
  if (rumbo != null) {
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 34 * s, (rumbo - 90 - 28) * RAD, (rumbo - 90 + 28) * RAD);
    ctx.closePath(); ctx.fillStyle = 'rgba(66,165,245,.45)'; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, 16 * s, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(25,118,210,.25)'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 8 * s, 0, 2 * Math.PI); ctx.fillStyle = '#1976d2'; ctx.fill();
  ctx.lineWidth = 3 * s; ctx.strokeStyle = '#fff'; ctx.stroke();
  // norte y atribución
  ctx.font = `800 ${Math.round(18 * s)}px ${FUENTE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4 * s; ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.strokeText('N ▲', x0 + tam - 26 * s, y0 + 18 * s); ctx.fillStyle = '#fff'; ctx.fillText('N ▲', x0 + tam - 26 * s, y0 + 18 * s);
  ctx.font = `600 ${Math.round(11 * s)}px ${FUENTE}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText('© Esri', x0 + 6 * s, y0 + tam - 4 * s);
  ctx.restore();
  ctx.lineWidth = Math.max(2, 3 * s); ctx.strokeStyle = '#fff';
  rectRedondo(ctx, x0, y0, tam, tam, tam * .05); ctx.stroke();
}

// Imprime sobre la foto ya girada: logo, brújula, minimapa y texto, cada uno con su opacidad
export async function componer(c, { lineas, logo = null, mapa = null, rumbo = null, estilo = null }) {
  const e = { ...ESTILO_BASE, ...estilo };
  const ctx = c.getContext('2d'), w = c.width, h = c.height, m = Math.min(w, h);
  const margen = Math.round(m * .025);
  if (logo) await dibujarLogo(ctx, logo, margen, m, e.logo, e.logoFondo);
  if (rumbo != null) {
    const r = m * .085, lado = Math.ceil(2 * r + 4);
    await capa(ctx, w - margen - lado, margen, lado, lado, e.brujula, (b) => dibujarBrujula(b, lado / 2, lado / 2, r, rumbo, e.brujulaFondo));
  }
  let reserva = 0;
  if (mapa) {
    const tam = Math.round(m * .3);
    await capa(ctx, margen, h - margen - tam, tam, tam, e.mapa, (b) => dibujarMinimapa(b, 0, 0, tam, { ...mapa, rumbo }));
    reserva = tam + margen;
  }
  dibujarTexto(ctx, w, h, lineas, margen, reserva, e.texto);
  return c;
}

// ================= captura y orientación =================

function lienzo(w, h, max = LADO_MAX) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  return c;
}

// Copia el cuadro girándolo r grados en sentido antihorario (0, 90, 180 o 270)
export function capturar(fuente, w, h, r = 0) { return capturarA(fuente, w, h, r, LADO_MAX); }

function capturarA(fuente, w, h, r, max) {
  const girado = r === 90 || r === 270;
  const c = lienzo(girado ? h : w, girado ? w : h, max);
  const k = c.width / (girado ? h : w);
  const ctx = c.getContext('2d');
  ctx.save();
  if (r === 90) { ctx.translate(0, c.height); ctx.rotate(-Math.PI / 2); }
  else if (r === 270) { ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); }
  else if (r === 180) { ctx.translate(c.width, c.height); ctx.rotate(Math.PI); }
  ctx.drawImage(fuente, 0, 0, w * k, h * k);
  ctx.restore();
  return c;
}

// Giro físico del teléfono (grados antihorarios: 0 vertical, 90 con la parte de arriba hacia
// la izquierda, 270 hacia la derecha, 180 de cabeza) a partir de beta/gamma del sensor.
// Devuelve null si el teléfono está casi plano (apuntando al suelo): se conserva el último giro.
function giroFisico(beta, gamma) {
  const b = beta * RAD, g = gamma * RAD;
  const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b); // dirección "arriba" en la pantalla
  if (Math.hypot(ux, uy) < 0.45) return null;
  const ang = (Math.atan2(ux, uy) / RAD + 360) % 360;
  const cerca = (Math.round(ang / 90) * 90) % 360;
  const dif = Math.min(Math.abs(ang - cerca), 360 - Math.abs(ang - cerca));
  return dif < 35 ? cerca : null; // zona intermedia: no cambia (evita saltos)
}

// Rumbo (grados desde el norte, horario) hacia donde apunta la cámara trasera.
// alpha absoluto: 0 = la parte de arriba del teléfono, acostado, apunta al norte.
export function rumboCamara(alpha, beta, gamma) {
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  let e = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  let n = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  if (Math.hypot(e, n) < 0.3) { // cámara hacia el suelo o el cielo: manda la parte de arriba del teléfono
    e = -Math.sin(a) * Math.cos(b); n = Math.cos(a) * Math.cos(b);
  }
  return (Math.atan2(e, n) / RAD + 360) % 360;
}

// Giro de la interfaz (si el sistema rotó la pantalla, la cámara ya entrega el cuadro girado)
function giroPantalla() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

function salida(canvas) {
  const k = 320 / Math.max(canvas.width, canvas.height);
  const m = document.createElement('canvas');
  m.width = Math.round(canvas.width * k); m.height = Math.round(canvas.height * k);
  m.getContext('2d').drawImage(canvas, 0, 0, m.width, m.height);
  return { datos: canvas.toDataURL('image/jpeg', CALIDAD_JPEG), mini: m.toDataURL('image/jpeg', .7), ancho: canvas.width, alto: canvas.height };
}

// ---- foto completa del sensor (ImageCapture, Android/Chrome) ----
// takePhoto entrega la foto con la orientación del sensor, que no siempre coincide con la del
// video. Se compara una huella en gris de ambos para saber cuánto girarla.
function huella(fuente, w, h, aspecto, n = 24) {
  // recorte central con el aspecto de referencia, reducido a n × (n/aspecto) y normalizado
  let cw = w, ch = w / aspecto;
  if (ch > h) { ch = h; cw = h * aspecto; }
  const c = document.createElement('canvas');
  c.width = n; c.height = Math.max(4, Math.round(n / aspecto));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(fuente, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, g = [];
  for (let i = 0; i < d.length; i += 4) g.push(.3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2]);
  const media = g.reduce((s, v) => s + v, 0) / g.length;
  const desv = Math.sqrt(g.reduce((s, v) => s + (v - media) ** 2, 0) / g.length) || 1;
  return g.map((v) => (v - media) / desv);
}
const diferencia = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

// Giro (antihorario) que hace coincidir la foto con el cuadro de referencia (huella ya calculada)
export function giroParaAlinear(foto, w, h, ref, aspecto) {
  let mejor = 0, err = Infinity;
  for (const r of [0, 90, 270, 180]) {
    const girada = capturarA(foto, w, h, r, 256);
    const e = diferencia(huella(girada, girada.width, girada.height, aspecto), ref);
    if (e < err) { err = e; mejor = r; }
  }
  return mejor;
}
export const huellaDe = (fuente, w, h) => huella(fuente, w, h, w / h);

// Devuelve {fuente, w, h, giro} con el giro (antihorario) que la alinea con el video, o null
async function fotoCompleta(captura, video) {
  if (!captura) return null;
  const aspecto = video.videoWidth / video.videoHeight;
  const ref = huella(video, video.videoWidth, video.videoHeight, aspecto); // en el instante del disparo
  const blob = await Promise.race([
    captura.takePhoto(captura.ajustes || undefined),
    new Promise((_, mal) => setTimeout(() => mal(new Error('tiempo')), 8000)),
  ]);
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  return { fuente: bmp, w: bmp.width, h: bmp.height, giro: giroParaAlinear(bmp, bmp.width, bmp.height, ref, aspecto) };
}

// Foto tomada con la cámara del sistema: se reduce y se le imprime el sello
export async function sellarArchivo(file, sello) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const c = lienzo(img.naturalWidth, img.naturalHeight);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  await componer(c, sello);
  return salida(c);
}

// ================= pantalla de cámara =================
// lineas(): texto del sello en ese momento; contexto(): {lat, lon, eje} o null si no hay GPS;
// opciones: {logo, mapa, brujula}; alFoto({datos, mini, rumbo}) por cada foto.
export function abrirCamara({ lineas, contexto, opciones = {}, alFoto, alCerrar }) {
  // iPhone pide permiso para el sensor de orientación y la brújula; debe pedirse dentro del
  // toque que abre la cámara
  try { window.DeviceOrientationEvent?.requestPermission?.().catch(() => {}); } catch { /* sin sensor */ }
  const cont = document.createElement('div');
  cont.id = 'camara';
  cont.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="cam-cont"></div>
    <div class="cam-res"></div>
    <canvas class="cam-brujula oculto" width="120" height="120"></canvas>
    <button class="cam-orient"></button>
    <div class="cam-msg oculto"></div>
    <div class="cam-sello"></div>
    <div class="cam-flash"></div>
    <div class="cam-barra">
      <button class="cam-listo">Listo</button>
      <button class="cam-disparo" aria-label="Tomar foto" disabled><span></span></button>
      <label class="cam-sistema">Cámara del<br>teléfono<input type="file" accept="image/*" capture="environment" hidden></label>
    </div>`;
  document.body.appendChild(cont);
  const video = cont.querySelector('video'), disparo = cont.querySelector('.cam-disparo');
  let stream = null, captura = null, n = 0, pendientes = 0;
  const resolucion = (w, h, tipo) => {
    const k = Math.min(1, LADO_MAX / Math.max(w, h)), mp = (w * k) * (h * k) / 1e6;
    cont.querySelector('.cam-res').textContent = `Calidad: ${mp >= 1 ? Math.round(mp) : mp.toFixed(1)} MP · ${tipo}`;
  };

  // ---- orientación: automática por sensor, o fijada a mano con el botón ----
  let fisico = 0, modo = 'auto';
  const giro = () => {
    const p = modo === 'v' ? 0 : modo === 'h' ? 90 : fisico;
    return (p - giroPantalla() + 360) % 360;
  };
  const pintarOrient = () => {
    const r = giro(), horizontal = r === 90 || r === 270;
    cont.classList.remove('rot-90', 'rot-180', 'rot-270');
    if (r) cont.classList.add('rot-' + r);
    cont.querySelector('.cam-orient').textContent =
      `${modo === 'auto' ? 'Auto' : 'Fijo'} · ${horizontal ? '▭ Horizontal' : '▯ Vertical'}`;
  };
  const alOrientar = (e) => {
    if (e.beta == null || e.gamma == null) return;
    const g = giroFisico(e.beta, e.gamma);
    if (g != null && g !== fisico) { fisico = g; pintarOrient(); }
  };
  cont.querySelector('.cam-orient').onclick = () => {
    modo = { auto: 'h', h: 'v', v: 'auto' }[modo];
    pintarOrient();
  };
  pintarOrient();

  // ---- brújula: Android da el ángulo absoluto en "deviceorientationabsolute";
  // iPhone da webkitCompassHeading. Se suaviza promediando el vector. ----
  let bx = 0, by = 0, rumbo = null;
  const alBrujula = (e) => {
    let a = null;
    if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) a = 360 - e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) a = e.alpha;
    if (a == null || e.beta == null || e.gamma == null) return;
    const r = rumboCamara(a, e.beta, e.gamma) * RAD;
    bx = bx * .8 + Math.sin(r) * .2; by = by * .8 + Math.cos(r) * .2;
    rumbo = (Math.atan2(bx, by) / RAD + 360) % 360;
  };
  const alSensor = (e) => { alOrientar(e); alBrujula(e); };
  window.addEventListener('deviceorientation', alSensor);
  window.addEventListener('deviceorientationabsolute', alBrujula);
  const rumboFoto = () => (opciones.brujula === false ? null : rumbo);

  // ---- vista previa: texto del sello y brújula ----
  const pintarSello = () => {
    cont.querySelector('.cam-sello').innerHTML = lineas().map((l, i) => `<div${i ? '' : ' class="t"'}>${esc(l)}</div>`).join('');
  };
  const lienzoB = cont.querySelector('.cam-brujula');
  const pintarBrujula = () => {
    const r = rumboFoto();
    lienzoB.classList.toggle('oculto', r == null);
    if (r == null) return;
    const ctx = lienzoB.getContext('2d'), est = { ...ESTILO_BASE, ...opciones.estilo };
    ctx.clearRect(0, 0, 120, 120);
    ctx.globalAlpha = est.brujula;
    dibujarBrujula(ctx, 60, 60, 56, r, est.brujulaFondo);
    ctx.globalAlpha = 1;
  };
  pintarSello();
  const ctx0 = contexto();
  if (ctx0 && opciones.mapa !== false) precargarMinimapa(ctx0.lat, ctx0.lon);
  const timer = setInterval(pintarSello, 1000);
  const timerB = setInterval(pintarBrujula, 200);
  const contar = () => {
    cont.querySelector('.cam-cont').textContent = pendientes ? 'Guardando foto…' : n ? `${n} foto${n > 1 ? 's' : ''} agregada${n > 1 ? 's' : ''}` : '';
  };
  const datosSello = () => {
    const c = contexto();
    return { lineas: lineas(), logo: opciones.logo || null, mapa: opciones.mapa === false ? null : c, rumbo: rumboFoto(), estilo: opciones.estilo };
  };
  const cerrar = () => {
    clearInterval(timer); clearInterval(timerB);
    window.removeEventListener('deviceorientation', alSensor);
    window.removeEventListener('deviceorientationabsolute', alBrujula);
    stream?.getTracks().forEach((t) => t.stop());
    cont.remove();
    alCerrar?.();
  };
  // "Listo" espera a que terminen las fotos que se están componiendo
  cont.querySelector('.cam-listo').onclick = async () => {
    while (pendientes) await new Promise((r) => setTimeout(r, 100));
    cerrar();
  };

  disparo.onclick = async () => {
    if (!video.videoWidth || pendientes) return; // una a la vez: la foto completa tarda un momento
    const flash = cont.querySelector('.cam-flash');
    flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 60);
    navigator.vibrate?.(40);
    // la orientación y los datos del sello se toman en el instante del disparo
    const g = giro(), sello = datosSello();
    pendientes++; contar();
    try {
      let c = null;
      try {
        const f = await fotoCompleta(captura, video);
        if (f) c = capturar(f.fuente, f.w, f.h, (f.giro + g) % 360);
      } catch {
        captura = null; // si la foto completa falla, el resto de la sesión se usa el video
        resolucion(video.videoWidth, video.videoHeight, 'video');
      }
      if (!c) c = capturar(video, video.videoWidth, video.videoHeight, g);
      await componer(c, sello);
      alFoto({ ...salida(c), rumbo: sello.rumbo });
      n++;
    } finally { pendientes--; contar(); }
  };

  cont.querySelector('.cam-sistema input').onchange = async (e) => {
    const sello = datosSello();
    pendientes++; contar();
    try {
      for (const f of e.target.files) { alFoto({ ...(await sellarArchivo(f, sello)), rumbo: sello.rumbo }); n++; }
    } finally { pendientes--; e.target.value = ''; contar(); }
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2880 } }, audio: false,
      });
      if (!cont.isConnected) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      disparo.disabled = false;
      // foto completa del sensor, a la mayor resolución que ofrezca el teléfono
      if ('ImageCapture' in window) {
        try {
          captura = new ImageCapture(stream.getVideoTracks()[0]);
          const cap = await captura.getPhotoCapabilities();
          if (cap?.imageWidth?.max && cap?.imageHeight?.max) {
            captura.ajustes = { imageWidth: cap.imageWidth.max, imageHeight: cap.imageHeight.max };
            resolucion(cap.imageWidth.max, cap.imageHeight.max, 'foto completa');
          } else resolucion(video.videoWidth, video.videoHeight, 'foto completa');
        } catch { captura = null; }
      }
      if (!captura) resolucion(video.videoWidth, video.videoHeight, 'video');
    } catch {
      const m = cont.querySelector('.cam-msg');
      m.textContent = 'No se pudo abrir la cámara dentro de la app (permiso de cámara). Usa «Cámara del teléfono»: la foto también sale con el sello de ubicación.';
      m.classList.remove('oculto');
      disparo.classList.add('oculto');
    }
  })();
}
