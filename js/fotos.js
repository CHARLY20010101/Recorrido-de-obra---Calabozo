// Fotos: lee la ubicación GPS y la fecha guardadas en la foto (EXIF) y la reduce
// de tamaño para enviarla. Las apps de cámara con GPS además imprimen los datos
// sobre la imagen, así que esa evidencia se conserva aunque el EXIF se pierda.

export async function leerExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o < v.byteLength - 4) {
      const marca = v.getUint16(o), largo = v.getUint16(o + 2);
      if (marca === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10);
      if ((marca & 0xFF00) !== 0xFF00) break;
      o += 2 + largo;
    }
  } catch { /* foto sin EXIF legible */ }
  return null;
}

function tiff(v, base) {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (p) => v.getUint16(base + p, le), u32 = (p) => v.getUint32(base + p, le);
  const ifd = (p) => {
    const n = u16(p), tags = {};
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12;
      tags[u16(e)] = { tipo: u16(e + 2), n: u32(e + 4), val: e + 8 };
    }
    return tags;
  };
  const rac = (p) => u32(p) / (u32(p + 4) || 1);
  const ascii = (t) => {
    const p = t.n > 4 ? u32(t.val) : t.val;
    let s = '';
    for (let i = 0; i < t.n - 1; i++) s += String.fromCharCode(v.getUint8(base + p + i));
    return s;
  };
  const ifd0 = ifd(u32(4));
  const out = {};
  if (ifd0[0x8769]) {
    const ex = ifd(u32(ifd0[0x8769].val));
    if (ex[0x9003]) out.fecha = ascii(ex[0x9003]);
  }
  if (ifd0[0x8825]) {
    const g = ifd(u32(ifd0[0x8825].val));
    const coord = (t) => { const p = u32(t.val); return rac(p) + rac(p + 8) / 60 + rac(p + 16) / 3600; };
    if (g[2] && g[4]) {
      const ref = (t) => String.fromCharCode(v.getUint8(base + t.val));
      out.lat = coord(g[2]) * (g[1] && ref(g[1]) === 'S' ? -1 : 1);
      out.lon = coord(g[4]) * (g[3] && ref(g[3]) === 'W' ? -1 : 1);
      if (!out.lat && !out.lon) { delete out.lat; delete out.lon; }
    }
  }
  return Object.keys(out).length ? out : null;
}

export async function reducir(file, lado = 1600, calidad = 0.8) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', calidad);
}
