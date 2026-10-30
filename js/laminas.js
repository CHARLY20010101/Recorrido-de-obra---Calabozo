// Láminas de planos del expediente (SVG): miniatura recortada en la ficha y visor con zoom.
// El SVG llega del servidor del proyecto solo con sesión; aquí se limpia antes de mostrarlo.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Ancho y alto de la hoja (viewBox) para recortar la miniatura
export function medidas(svg) {
  const m = String(svg).match(/viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/);
  return m ? { W: +m[3], H: +m[4] } : { W: 1000, H: 700 };
}

// "Sección a media ladera" -> "Media ladera"
export function nombreCorto(titulo) {
  const t = String(titulo).replace(/^secci[oó]n\s+(t[ií]pica\s+)?((a|en|de)\s+)?/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Zona [x, y, ancho, alto] de la lámina vista a todo el ancho de la ficha
export function miniatura(url, W, H, r) {
  const [x, y, w, h] = r && r.length === 4 ? r : [0, 0, W, H];
  return `<span class="lam-mini" style="aspect-ratio:${w} / ${h}"><img src="${url}" alt="" draggable="false"
    style="width:${(100 * W / w).toFixed(3)}%;left:${(-100 * x / w).toFixed(3)}%;top:${(-100 * y / h).toFixed(3)}%"></span>`;
}

// Quita todo lo que pueda ejecutar código o cargar algo de afuera
export function limpiarSVG(texto) {
  const doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('La lámina no es un SVG válido');
  svg.querySelectorAll('script, foreignObject, iframe, object, embed, a, animate, set, animateTransform, animateMotion').forEach((e) => e.remove());
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase(), v = at.value.trim();
      if (n.startsWith('on')) el.removeAttribute(at.name);
      else if ((n === 'href' || n === 'xlink:href') && !/^#|^data:image\/(png|jpe?g|gif|webp);/i.test(v)) el.removeAttribute(at.name);
      else if (n === 'style' && /url\(\s*['"]?(?!#)/i.test(v)) el.removeAttribute(at.name);
    }
  }
  return svg;
}

// Visor a pantalla completa: dos dedos = zoom, un dedo = mover, doble toque = acercar,
// rueda del ratón en la PC. "Girar" pone la lámina en horizontal para verla con el teléfono echado.
export function abrirVisor({ titulo, svg: texto, enfoques = {}, inicial = 'Sección', nota = '', textoTodo = 'Lámina completa' }) {
  const svg = limpiarSVG(texto);
  const [, , W, H] = (svg.getAttribute('viewBox') || '0 0 1000 700').split(/[\s,]+/).map(Number);
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // el dibujo va dentro de un grupo para poder girarlo 90° (las definiciones quedan afuera)
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (const n of [...svg.childNodes]) if (n.nodeName !== 'defs') g.appendChild(n);
  svg.appendChild(g);

  document.getElementById('plano')?.remove();
  const v = document.createElement('div');
  v.id = 'plano';
  const nombres = Object.keys(enfoques);
  v.innerHTML = `<div class="plano-cab"><span class="t">${esc(titulo)}</span>
      <span class="plano-zoom"><button data-z="0.5" aria-label="Alejar">−</button><button data-z="2" aria-label="Acercar">+</button></span>
      <button class="plano-girar" title="Girar la lámina">⟳ Girar</button><button class="plano-x" aria-label="Cerrar">✕</button></div>
    <div class="plano-lienzo"></div>
    ${nota ? `<div class="plano-nota">${esc(nota)}</div>` : ''}
    <div class="plano-pie">${nombres.map((k) => `<button data-k="${esc(k)}">${esc(k)}</button>`).join('')}<button data-k="">${esc(textoTodo)}</button></div>`;
  document.body.appendChild(v);
  const lienzo = v.querySelector('.plano-lienzo');
  const el = document.importNode(svg, true);
  lienzo.appendChild(el);
  const grupo = el.lastChild;

  let girada = false, vb = null, sel = null, cuadro = 0;
  const full = () => (girada ? { w: H, h: W } : { w: W, h: H });
  // zona de la hoja -> zona en pantalla (con la lámina girada, el eje x de la pantalla es el y de la hoja)
  const aPantalla = ([x, y, w, h]) => (girada ? [H - y - h, x, h, w] : [x, y, w, h]);
  const pintar = () => {
    if (cuadro) return;
    cuadro = requestAnimationFrame(() => { cuadro = 0; el.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); });
  };
  const encuadrar = (r) => {
    const cw = lienzo.clientWidth || 1, ch = lienzo.clientHeight || 1, ar = cw / ch;
    let [x, y, w, h] = aPantalla(r);
    x -= w * 0.03; y -= h * 0.03; w *= 1.06; h *= 1.06;
    if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
    vb = { x, y, w, h }; pintar();
  };
  const ir = (k) => {
    sel = k;
    v.querySelectorAll('.plano-pie [data-k]').forEach((b) => b.classList.toggle('sel', b.dataset.k === k));
    encuadrar(k && enfoques[k] ? enfoques[k] : [0, 0, W, H]);
  };
  const zoom = (k, px, py) => {
    const u = vb.w / lienzo.clientWidth, f = full();
    const nw = Math.min(Math.max(vb.w / k, f.w / 400), f.w * 1.6), kk = vb.w / nw;
    vb = { x: vb.x + px * u - px * u / kk, y: vb.y + py * u - py * u / kk, w: nw, h: vb.h / kk };
    pintar();
  };
  const ponerGiro = (si) => {
    girada = si;
    grupo.setAttribute('transform', si ? `translate(${H} 0) rotate(90)` : '');
    v.classList.toggle('girada', si);
  };
  // el giro se recuerda en este teléfono para la próxima lámina
  const girar = () => {
    ponerGiro(!girada);
    try { localStorage.setItem('plano-girada', girada ? '1' : ''); } catch { /* sin almacenamiento */ }
    ir(sel);
  };

  // gestos
  const ptrs = new Map();
  let toque = null, ultimoToque = 0;
  const pos = (e) => { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  lienzo.addEventListener('pointerdown', (e) => {
    try { lienzo.setPointerCapture(e.pointerId); } catch { /* el dedo ya se levantó */ }
    ptrs.set(e.pointerId, pos(e));
    toque = ptrs.size === 1 ? { ...pos(e), t: Date.now(), movio: false } : null;
  });
  lienzo.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const antes = [...ptrs.values()].map((p) => ({ ...p }));
    ptrs.set(e.pointerId, pos(e));
    const ahora = [...ptrs.values()];
    const u = vb.w / lienzo.clientWidth;
    if (ahora.length === 1) {
      const dx = ahora[0].x - antes[0].x, dy = ahora[0].y - antes[0].y;
      if (toque && Math.hypot(ahora[0].x - toque.x, ahora[0].y - toque.y) > 8) toque.movio = true;
      vb.x -= dx * u; vb.y -= dy * u; pintar();
    } else if (ahora.length === 2) {
      const m = (a) => ({ x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }), d = (a) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      const m0 = m(antes), m1 = m(ahora);
      vb.x -= (m1.x - m0.x) * u; vb.y -= (m1.y - m0.y) * u;
      zoom(d(ahora) / d(antes), m1.x, m1.y);
    }
  });
  const soltar = (e) => {
    ptrs.delete(e.pointerId);
    if (e.type === 'pointerup' && toque && !toque.movio && Date.now() - toque.t < 300) {
      if (Date.now() - ultimoToque < 350) { zoom(2, toque.x, toque.y); ultimoToque = 0; } else ultimoToque = Date.now();
    }
    toque = null;
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
  lienzo.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });

  const alCambiarTamano = () => { if (vb) { const c = { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 }, ar = lienzo.clientWidth / lienzo.clientHeight; vb.h = vb.w / ar; vb.x = c.x - vb.w / 2; vb.y = c.y - vb.h / 2; pintar(); } };
  window.addEventListener('resize', alCambiarTamano);
  const cerrar = () => { window.removeEventListener('resize', alCambiarTamano); v.remove(); };
  v.querySelector('.plano-x').onclick = cerrar;
  v.querySelector('.plano-girar').onclick = girar;
  v.querySelectorAll('.plano-pie [data-k]').forEach((b) => b.onclick = () => ir(b.dataset.k));
  v.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => zoom(+b.dataset.z, lienzo.clientWidth / 2, lienzo.clientHeight / 2));
  try { if (localStorage.getItem('plano-girada') === '1') ponerGiro(true); } catch { /* sin almacenamiento */ }
  ir(inicial in enfoques ? inicial : '');
  return { cerrar, ir, girar, el: v };
}
