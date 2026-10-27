// Cámara de obra: vista en vivo y foto con un sello impreso en la imagen (progresiva,
// coordenadas, fecha, usuario y obra), al estilo de las apps de cámara GPS pero con la
// progresiva del proyecto. Si el teléfono no deja abrir la cámara dentro de la app, la
// "Cámara del teléfono" también sirve: a esa foto se le imprime el mismo sello.
//
// La app está fijada en vertical, así que la cámara entrega siempre un cuadro vertical.
// Con el sensor de orientación se sabe si el teléfono está en horizontal y la foto se gira
// para que quede horizontal y con el sello derecho.

const LADO_MAX = 2048;
const RAD = Math.PI / 180;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Sello en la esquina inferior izquierda; la primera línea (progresiva) va resaltada
export function dibujarSello(ctx, w, h, lineas) {
  const fs = Math.max(14, Math.round(Math.min(w, h) / 30));
  const fsT = Math.round(fs * 1.3), pad = Math.round(fs * .7), lh = Math.round(fs * 1.35);
  const fuente = (t) => `${t ? 800 : 600} ${t ? fsT : fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  let ancho = 0;
  lineas.forEach((l, i) => { ctx.font = fuente(i === 0); ancho = Math.max(ancho, ctx.measureText(l).width); });
  const alto = fsT * 1.35 + (lineas.length - 1) * lh + pad * 1.4;
  const x = Math.round(pad * .6), y = Math.round(h - alto - pad * .6);
  const bw = Math.min(w - 2 * x, ancho + 2 * pad);
  ctx.fillStyle = 'rgba(0,0,0,.58)';
  ctx.fillRect(x, y, bw, alto);
  ctx.textBaseline = 'top';
  let yy = y + pad * .7;
  lineas.forEach((l, i) => {
    ctx.font = fuente(i === 0);
    ctx.fillStyle = i === 0 ? '#ffb300' : '#ffffff';
    ctx.fillText(l, x + pad, yy, bw - 2 * pad);
    yy += i === 0 ? fsT * 1.35 : lh;
  });
}

function lienzo(w, h) {
  const k = Math.min(1, LADO_MAX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  return c;
}

// Copia el cuadro girándolo r grados en sentido antihorario (0, 90, 180 o 270)
export function capturar(fuente, w, h, r = 0) {
  const girado = r === 90 || r === 270;
  const c = lienzo(girado ? h : w, girado ? w : h);
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
  return { datos: canvas.toDataURL('image/jpeg', .85), mini: m.toDataURL('image/jpeg', .7) };
}

// Foto tomada con la cámara del sistema: se reduce y se le imprime el sello
export async function sellarArchivo(file, lineas) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const c = lienzo(img.naturalWidth, img.naturalHeight);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  dibujarSello(ctx, c.width, c.height, lineas);
  return salida(c);
}

// Pantalla de cámara. lineas(): texto del sello en ese momento; alFoto({datos, mini}) por cada foto.
export function abrirCamara({ lineas, alFoto, alCerrar }) {
  // iPhone pide permiso para el sensor de orientación; debe pedirse dentro del toque que abre la cámara
  try { window.DeviceOrientationEvent?.requestPermission?.().catch(() => {}); } catch { /* sin sensor */ }
  const cont = document.createElement('div');
  cont.id = 'camara';
  cont.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="cam-cont"></div>
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
  let stream = null, n = 0;

  // orientación: automática por sensor, o fijada a mano con el botón
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
  window.addEventListener('deviceorientation', alOrientar);
  cont.querySelector('.cam-orient').onclick = () => {
    modo = { auto: 'h', h: 'v', v: 'auto' }[modo];
    pintarOrient();
  };
  pintarOrient();

  const pintarSello = () => {
    cont.querySelector('.cam-sello').innerHTML = lineas().map((l, i) => `<div${i ? '' : ' class="t"'}>${esc(l)}</div>`).join('');
  };
  pintarSello();
  const timer = setInterval(pintarSello, 1000);
  const contar = () => { cont.querySelector('.cam-cont').textContent = n ? `${n} foto${n > 1 ? 's' : ''} agregada${n > 1 ? 's' : ''}` : ''; };
  const cerrar = () => {
    clearInterval(timer);
    window.removeEventListener('deviceorientation', alOrientar);
    stream?.getTracks().forEach((t) => t.stop());
    cont.remove();
    alCerrar?.();
  };
  cont.querySelector('.cam-listo').onclick = cerrar;

  disparo.onclick = () => {
    if (!video.videoWidth) return;
    const flash = cont.querySelector('.cam-flash');
    flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 60);
    navigator.vibrate?.(40);
    const c = capturar(video, video.videoWidth, video.videoHeight, giro());
    dibujarSello(c.getContext('2d'), c.width, c.height, lineas());
    alFoto(salida(c));
    n++; contar();
  };

  cont.querySelector('.cam-sistema input').onchange = async (e) => {
    for (const f of e.target.files) { alFoto(await sellarArchivo(f, lineas())); n++; }
    e.target.value = '';
    contar();
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
    } catch {
      const m = cont.querySelector('.cam-msg');
      m.textContent = 'No se pudo abrir la cámara dentro de la app (permiso de cámara). Usa «Cámara del teléfono»: la foto también sale con el sello de ubicación.';
      m.classList.remove('oculto');
      disparo.classList.add('oculto');
    }
  })();
}
