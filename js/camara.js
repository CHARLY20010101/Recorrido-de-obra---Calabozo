// Cámara de obra: vista en vivo y foto con un sello impreso en la imagen (progresiva, lado,
// coordenadas, fecha, usuario y obra), al estilo de las apps de cámara GPS pero con la
// progresiva del proyecto. Si el teléfono no deja abrir la cámara dentro de la app, la
// "Cámara del teléfono" también sirve: a esa foto se le imprime el mismo sello.

const LADO_MAX = 2048;
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
  const cont = document.createElement('div');
  cont.id = 'camara';
  cont.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="cam-cont"></div>
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

  const pintarSello = () => {
    cont.querySelector('.cam-sello').innerHTML = lineas().map((l, i) => `<div${i ? '' : ' class="t"'}>${esc(l)}</div>`).join('');
  };
  pintarSello();
  const timer = setInterval(pintarSello, 1000);
  const contar = () => { cont.querySelector('.cam-cont').textContent = n ? `${n} foto${n > 1 ? 's' : ''} agregada${n > 1 ? 's' : ''}` : ''; };
  const cerrar = () => {
    clearInterval(timer);
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
    const c = lienzo(video.videoWidth, video.videoHeight), ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, c.width, c.height);
    dibujarSello(ctx, c.width, c.height, lineas());
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
