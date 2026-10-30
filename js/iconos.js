// Pictogramas de los elementos viales (SVG 24×24, trazo blanco sobre el color del tipo)
// y la flecha de navegación del usuario. Formas distintas para no confundirlos:
// elementos = cuadro redondeado; usuario = círculo azul con flecha; observaciones = gota.

const P = {
  // alcantarilla: boca del tubo sobre el terreno
  ALC: '<path d="M3 19.5h18"/><circle cx="12" cy="11.5" r="6.5"/><circle cx="12" cy="11.5" r="3"/>',
  // badén: depresión de la vía con agua
  BAD: '<path d="M2 8h5c2 0 3 6 5 6s3-6 5-6h5"/><path d="M8 18.5c1.3-1 2.7-1 4 0s2.7 1 4 0"/>',
  // puente: tablero, estribos y arco
  PTE: '<path d="M2 8.5h20"/><path d="M4 8.5V19M20 8.5V19"/><path d="M4 19c3-7.5 13-7.5 16 0"/>',
  // cuneta: sección en V con agua
  CUN: '<path d="M2 6.5l7 10h6l7-10"/><path d="M9.5 12.5h5"/>',
  // barrera de seguridad: viga y postes
  BAR: '<rect x="3" y="7" width="18" height="5" rx="1"/><path d="M6 12v8M12 12v8M18 12v8"/>',
  // DME: montículo con flecha de descarga
  DME: '<path d="M2 20c3-6.5 6-8.5 10-8.5s7 2 10 8.5z"/><path d="M12 2.5v6.5M9.3 6.5 12 9.2l2.7-2.7"/>',
  // fuente de agua: gota
  AGU: '<path d="M12 3s-6.5 7.2-6.5 11.2a6.5 6.5 0 0 0 13 0C18.5 10.2 12 3 12 3z"/><path d="M9.2 14.5a2.8 2.8 0 0 0 2.8 2.8"/>',
  // patio de máquinas: excavadora
  PAT: '<rect x="2.5" y="15.5" width="12" height="4" rx="2"/><path d="M4.5 15.5V11h6l2 4.5"/><path d="M10.5 11 16 5l5 5"/><path d="M21 10l-1.5 3.5H17"/>',
  // MCA (muro de concreto armado): sección en L con relleno
  MCA: '<path d="M7 3h4v13h8v4H4v-4h3z"/><path d="M14 9.5l4-4M14 13l6-6"/>',
  // muro: aparejo de ladrillos
  MUR: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  // señalización: señal preventiva en poste
  SEN: '<path d="M12 2.5 19.5 14h-15z"/><path d="M12 14v7.5M12 7v3"/>',
  // otro
  OTR: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6"/>',
};

export function svgTipo(tipo, tam = 20) {
  return `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[tipo] || P.OTR}</svg>`;
}

// Icono en el mapa (Leaflet)
// clase: '' | 'anulado' (gris y transparente) | 'pendiente' (cambio aún no enviado al servidor)
export function iconoElemento(tipo, color, clase = '') {
  return L.divIcon({
    className: 'mk-elem' + (clase ? ' ' + clase : ''),
    html: `<div class="ie" style="background:${color}">${svgTipo(tipo)}</div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16],
  });
}

// Icono pequeño para listas y leyendas
export const miniTipo = (tipo, color, tam = 26) =>
  `<span class="ie-mini" style="background:${color};width:${tam}px;height:${tam}px">${svgTipo(tipo, Math.round(tam * .68))}</span>`;

// Punto de control: triángulo topográfico. Geodésico = azul con centro blanco; BM = negro.
// Observado = rojo; reemplazado o anulado = gris. La etiqueta con el código se ve de cerca.
// Triángulo del punto: azul = geodésico, negro = BM, rojo = observado, gris = anulado o reemplazado
export function svgPunto(tipo, estado, t) {
  const geo = tipo === 'GEODESICO';
  const color = estado === 'OBSERVADO' ? '#c62828' : estado === 'ANULADO' || estado === 'REEMPLAZADO' ? '#9e9e9e' : geo ? '#1565c0' : '#111';
  t = t ?? (geo ? 24 : 18);
  return `<svg viewBox="0 0 20 20" width="${t}" height="${t}" aria-hidden="true"><path d="M10 2 18.5 17h-17z" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="12" r="${geo ? 2.6 : 1.8}" fill="#fff"/></svg>`;
}

export function iconoPunto(tipo, estado, codigo) {
  const t = tipo === 'GEODESICO' ? 24 : 18;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return L.divIcon({
    className: 'mk-punto',
    html: `${svgPunto(tipo, estado, t)}<span class="etq-punto">${esc(codigo)}</span>`,
    iconSize: [t, t], iconAnchor: [t / 2, t * .58], popupAnchor: [0, -t / 2],
  });
}

// Punto de control (BM): triángulo topográfico
export function iconoBM() {
  return L.divIcon({
    className: 'mk-bm',
    html: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2 18.5 17h-17z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="12" r="2" fill="#fff"/></svg>',
    iconSize: [18, 18], iconAnchor: [9, 11], popupAnchor: [0, -10],
  });
}

// Usuario: círculo azul con flecha blanca; la flecha gira hacia donde avanzas
export function iconoUsuario() {
  return L.divIcon({
    className: 'mk-yo',
    html: `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="#1976d2" opacity=".18"/>
      <circle cx="24" cy="24" r="12.5" fill="#1976d2" stroke="#fff" stroke-width="3"/>
      <path d="M24 14.5 31 30l-7-4-7 4z" fill="#fff"/>
    </svg>`,
    iconSize: [48, 48], iconAnchor: [24, 24],
  });
}
