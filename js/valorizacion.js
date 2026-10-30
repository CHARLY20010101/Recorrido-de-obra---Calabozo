// Valorizaciones (fase 4): la valorización N toma todos los metrados VERIFICADOS hasta el fin del
// periodo que aún no se valorizaron, por partida × P.U. Aquí se calcula la propuesta igual que la
// calcula el servidor al cerrarla (el servidor vuelve a calcular todo y es el que manda).

export const r2 = (v) => Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

export const cerradas = (vals) => vals.filter((v) => v.estado === 'CERRADA').sort((a, b) => a.n - b.n);
export const porValorizar = (metrados, fin) => metrados.filter((m) => m.estado === 'VERIFICADO' && !m.valorizacion && m.fecha && m.fecha <= fin);
export const contratoCompleto = (c) => !!c && c.montoContrato > 0 && c.gg != null && c.utilidad != null && c.igv != null;

// Costo directo del contrato (metrado contratado × P.U.)
export const cdContrato = (partidas) => r2(partidas.filter((p) => !p.titulo).reduce((s, p) => s + r2((p.contrato || 0) * (p.pu || 0)), 0));

export function preparar({ partidas, metrados, valorizaciones, contrato: c, fin, k = 1, dedReajuste = 0, amortAD = null, amortAM = 0, retencion = null, otros = 0 }) {
  const prev = cerradas(valorizaciones), sel = porValorizar(metrados, fin);
  const pu = Object.fromEntries(partidas.filter((p) => !p.titulo).map((p) => [p.item, p.pu]));
  const det = {};
  for (const m of sel) det[m.partida] = (det[m.partida] || 0) + m.cantidad;
  const sinPU = Object.keys(det).filter((k) => pu[k] == null);
  let cd = 0;
  for (const k of Object.keys(det)) { const q = r4(det[k]); det[k] = [q, r2(q * (pu[k] || 0))]; cd += det[k][1]; }
  cd = r2(cd);
  const gg = r2(cd * c.gg / 100), ut = r2(cd * c.utilidad / 100), bruta = r2(cd + gg + ut), reaj = r2(bruta * (k - 1));
  const fIgv = 1 + c.igv / 100, suma = (campo) => prev.reduce((s, v) => s + (v[campo] || 0), 0);
  // adelanto directo: descuento proporcional en cada valorización (RLGCP art. 180.1), sin pasar el saldo
  const saldoAD = Math.max(0, r2(c.adelantoDirecto / fIgv - suma('amortAD')));
  const propAD = Math.min(saldoAD, r2(bruta * (c.adelantoDirecto || 0) / c.montoContrato));
  const saldoAM = Math.max(0, r2(c.adelantoMateriales / fIgv - suma('amortAM')));
  const aAD = amortAD ?? propAD;
  const sub = r2(bruta + reaj - dedReajuste - aAD - amortAM), igv = r2(sub * c.igv / 100), total = r2(sub + igv);
  // retención de la garantía de fiel cumplimiento: % de cada pago hasta completar el % del contrato
  const saldoRet = Math.max(0, r2(c.montoContrato * (c.retencion || 0) / 100 - suma('retencion')));
  const propRet = Math.min(saldoRet, Math.max(0, r2(total * (c.retencion || 0) / 100)));
  const ret = retencion ?? propRet;
  return {
    sel, det, sinPU, cd, gg, ut, bruta, k, reaj, dedReajuste, amortAD: aAD, amortAM, sub, igv, total, retencion: ret, otros,
    neto: r2(total - ret - otros), propuestas: { amortAD: propAD, retencion: propRet }, saldos: { AD: saldoAD, AM: saldoAM, ret: saldoRet },
  };
}

// Cuadro por partida: contrato, anterior, actual, acumulado y saldo (metrado y monto).
// antes = valorizaciones cerradas anteriores; actual = detalle {item: [metrado, monto]}
export function cuadro(partidas, antes, actual) {
  const filas = [];
  for (const p of partidas) {
    if (p.titulo) { filas.push({ titulo: true, item: p.item, desc: p.desc }); continue; }
    const pres = r2((p.contrato || 0) * (p.pu || 0));
    const ant = antes.reduce((a, v) => { const x = v.partidas?.[p.item]; return x ? [a[0] + x[0], a[1] + x[1]] : a; }, [0, 0]);
    const act = actual[p.item] || [0, 0], acu = [r4(ant[0] + act[0]), r2(ant[1] + act[1])];
    filas.push({
      item: p.item, desc: p.desc, und: p.und, contrato: p.contrato, pu: p.pu, pres, ant: [r4(ant[0]), r2(ant[1])], act, acu,
      pct: pres ? acu[1] / pres : 0, saldo: [r4((p.contrato || 0) - acu[0]), r2(pres - acu[1])],
    });
  }
  return filas;
}

// Filas para Excel: encabezado, cuadro por partida y resumen de montos
export function filasExcel({ obra, v, partidas, antes, contrato: c, cdCont }) {
  const cu = cuadro(partidas, antes, v.partidas || {});
  const pct = (x) => Math.round(x * 10000) / 100;
  const acuCD = r2(antes.reduce((s, x) => s + x.cd, 0) + v.cd);
  const filas = [
    [obra], [`Valorización N° ${v.n} · periodo del ${v.ini} al ${v.fin}${v.estado === 'ANULADA' ? ' · ANULADA' : ''}`],
    [`Cerrada por ${v.cerradaPor || '—'}${v.documento ? ' · ' + v.documento : ''}`], [],
    ['Item', 'Descripción', 'Und', 'Metrado contrato', 'P.U. (S/)', 'Presupuesto (S/)', 'Anterior metrado', 'Anterior (S/)', 'Actual metrado', 'Actual (S/)',
      'Acumulado metrado', 'Acumulado (S/)', '% avance', 'Saldo metrado', 'Saldo (S/)'],
  ];
  for (const f of cu) {
    if (f.titulo) { filas.push([f.item, f.desc]); continue; }
    filas.push([f.item, f.desc, f.und, f.contrato, f.pu, f.pres, f.ant[0] || '', f.ant[1] || '', f.act[0] || '', f.act[1] || '', f.acu[0] || '', f.acu[1] || '', f.acu[1] ? pct(f.pct) : '', f.saldo[0], f.saldo[1]]);
  }
  filas.push([], ['RESUMEN', '', '', '', '', 'S/'],
    ['', 'Costo directo del periodo', '', '', '', v.cd],
    ['', `Gastos generales (${c.gg} %)`, '', '', '', v.gg],
    ['', `Utilidad (${c.utilidad} %)`, '', '', '', v.utilidad],
    ['', 'Valorización bruta (sin IGV)', '', '', '', v.bruta],
    ['', `Reajuste (K = ${v.k})`, '', '', '', v.reajuste],
    ['', 'Deducción del reajuste por adelantos', '', '', '', -v.dedReajuste],
    ['', 'Amortización del adelanto directo', '', '', '', -v.amortAD],
    ['', 'Amortización del adelanto para materiales', '', '', '', -v.amortAM],
    ['', 'Subtotal sin IGV', '', '', '', v.subtotal],
    ['', `IGV (${c.igv} %)`, '', '', '', v.igv],
    ['', 'Total de la valorización (con IGV)', '', '', '', v.total],
    ['', `Retención de garantía de fiel cumplimiento (${c.retencion ?? 0} %)`, '', '', '', -v.retencion],
    ['', 'Otros descuentos (penalidades u otros)', '', '', '', -v.otros],
    ['', 'Neto a pagar', '', '', '', v.neto],
    [],
    ['', 'Costo directo del contrato', '', '', '', cdCont],
    ['', 'Costo directo valorizado acumulado', '', '', '', acuCD],
    ['', '% de avance acumulado (costo directo)', '', '', '', cdCont ? pct(acuCD / cdCont) : ''],
    ['', `Metrados incluidos: ${v.nMetrados}`]);
  if (v.obs) filas.push(['', 'Observaciones: ' + v.obs]);
  return filas;
}
