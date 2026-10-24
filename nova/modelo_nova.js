/*
 * Modelo NOVO (só para o /nova; o site principal continua com coletor/modelo.js).
 *
 * Diferença para o modelo atual: a virada de cada cidade é medida contra o 1º turno das MESMAS urnas que
 * já chegaram (estimadas pela ordem de chegada do 1º turno), e o que falta é projetado a partir do
 * 1º turno das urnas que faltam. A correção entra com 60% da força (LAM), escolhida deixando uma noite
 * de fora nos testes de 2002 a 2022. O resto (agrupamento por cidade, estado e região; comparecimento)
 * é o mesmo modelo do site, com os mesmos números.
 *
 * Duas formas de saber quanto da cidade já foi contado:
 *   'eleitorado' — eleitorado das urnas contadas (est) e total (te) do TSE: a forma testada como melhor;
 *   'secoes'     — só nº de seções contadas/total (st/ts): usada quando o arquivo de cidades não traz est/te.
 * Cada forma tem a sua faixa, calibrada nas 6 noites com o próprio modelo, e alargada em 25% (FATOR).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) {
    const path = require('path'), fs = require('fs');
    const cand = [path.join(__dirname, '../app/modelo.js'), path.join(__dirname, '../coletor/modelo.js')];
    module.exports = fabrica(require(cand.find(f => fs.existsSync(f))));
  } else raiz.ModeloNovo = fabrica(raiz.Modelo);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  const LAM = 0.6, FATOR = 1.25;

  /*
   * lista: [{cod, uf}] · refs: {cod: {pt, adv, val, aptos}} (1º turno, por cidade)
   * curvas: {cod: [ap, pt, adv, val, ap, pt, adv, val, ...]} — urnas do 1º turno da cidade, na ordem de chegada
   */
  function montar(lista, refs, curvas) {
    const U = M.unidades(lista.map(m => ({cod: m.cod, uf: m.uf, A: 0})), refs);
    const n = U.n;
    let tot = 0;
    const cs = new Array(n);
    for (let u = 0; u < n; u++) { const c = curvas && curvas[U.cod[u]]; cs[u] = Array.isArray(c) && c.length >= 4 ? c : null; tot += (cs[u] ? cs[u].length / 4 : 0) + 1; }
    const off = new Int32Array(n + 1), F = k => new Float64Array(k);
    const cap = F(tot), cpt = F(tot), cad = F(tot), cva = F(tot);
    let p = 0, comCurva = 0;
    for (let u = 0; u < n; u++) {
      off[u] = p; p++;
      const c = cs[u];
      if (c) { comCurva++; for (let i = 0; i + 3 < c.length; i += 4) { cap[p] = cap[p - 1] + c[i]; cpt[p] = cpt[p - 1] + c[i + 1]; cad[p] = cad[p - 1] + c[i + 2]; cva[p] = cva[p - 1] + c[i + 3]; p++; } }
    }
    off[n] = p;
    U.C = {off, cap, cpt, cad, cva, comCurva};
    for (let u = 0; u < n; u++) { const T = cap[off[u + 1] - 1]; if (!(U.A[u] > 0) && T > 0) U.A[u] = T; }
    return U;
  }

  // ponto da curva da cidade u: por eleitorado (alvo = eleitorado do 1º turno acumulado) ou por nº de urnas
  function naCurva(C, u, modo, alvo, o) {
    const a0 = C.off[u], a1 = C.off[u + 1] - 1;
    let j0, j1, fr;
    if (modo === 'eleitorado') {
      let lo = a0, hi = a1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C.cap[m] <= alvo) lo = m; else hi = m; }
      const d = C.cap[hi] - C.cap[lo];
      j0 = lo; j1 = hi; fr = d > 0 ? Math.min(1, Math.max(0, (alvo - C.cap[lo]) / d)) : 1;
    } else {
      const n1 = a1 - a0, pos = alvo * n1, i = Math.min(n1 - 1, Math.floor(pos));
      j0 = a0 + i; j1 = j0 + 1; fr = Math.min(1, pos - i);
    }
    const I = arr => arr[j0] + fr * (arr[j1] - arr[j0]);
    o.cap = I(C.cap); o.cpt = I(C.cpt); o.cad = I(C.cad); o.cva = I(C.cva);
    o.Tap = C.cap[a1]; o.Tpt = C.cpt[a1]; o.Tad = C.cad[a1]; o.Tva = C.cva[a1];
  }

  /*
   * st: por unidade — x, y (votos de Lula e do adversário), v (válidos dos dois), sc e ts (seções contadas e total);
   *     a e A (eleitorado das seções contadas e total, do TSE) quando houver.
   * modo: 'eleitorado' (precisa de a e A) ou 'secoes'.
   */
  function projetar(U, st, modo, lam) {
    const n = U.n, C = U.C, lg = M.logit, ex = M.expit, L = lam == null ? LAM : lam, o = {};
    const rc = new Float64Array(n), rr = new Float64Array(n), nc = new Float64Array(n), nr = new Float64Array(n), aa = new Float64Array(n), AA = new Float64Array(n);
    for (let u = 0; u < n; u++) {
      const r = U.r_1t[u], nu = U.nu_ref[u], n1 = C.off[u + 1] - 1 - C.off[u];
      rc[u] = rr[u] = r; nc[u] = nr[u] = nu;
      const Tap = C.cap[C.off[u + 1] - 1], Tpt = C.cpt[C.off[u + 1] - 1], Tad = C.cad[C.off[u + 1] - 1];
      const usa = n1 > 0 && Tap > 0 && Tpt + Tad > 0;
      let q;
      if (modo === 'eleitorado') {
        AA[u] = st.A[u] > 0 ? st.A[u] : U.A[u];
        aa[u] = Math.max(0, st.a[u] || 0);
        q = AA[u] > 0 ? Math.min(1, aa[u] / AA[u]) : 0;
        if (!usa || aa[u] <= 0) continue;
        naCurva(C, u, modo, q * Tap, o);
      } else {
        AA[u] = usa ? Tap : U.A[u];
        q = st.ts[u] > 0 ? Math.min(1, st.sc[u] / st.ts[u]) : 0;
        if (!usa) { aa[u] = q * AA[u]; continue; }
        naCurva(C, u, modo, q, o);
        aa[u] = o.cap;
        if (!(st.sc[u] > 0)) continue;
      }
      const rpt = o.Tpt - o.cpt, rad = o.Tad - o.cad, rva = o.Tva - o.cva, rap = o.Tap - o.cap;
      const rc0 = o.cpt + o.cad > 0 ? o.cpt / (o.cpt + o.cad) : r, rr0 = rpt + rad > 0.5 ? rpt / (rpt + rad) : rc0;
      const nc0 = o.cap > 0 ? o.cva / o.cap : nu, nr0 = rap > 0.5 ? rva / rap : nc0;
      rc[u] = r + L * (rc0 - r); rr[u] = r + L * (rr0 - r); nc[u] = nu + L * (nc0 - nu); nr[u] = nu + L * (nr0 - nu);
    }
    const contou = u => modo === 'eleitorado' ? aa[u] > 0 : st.sc[u] > 0;
    const d = new Float64Array(n), w = new Float64Array(n);
    for (let u = 0; u < n; u++) { const den = st.x[u] + st.y[u]; if (den > 0) { d[u] = lg((st.x[u] + 0.5) / (den + 1)) - lg(rc[u]); w[u] = den; } }
    const s = M.pooled(U, d, w, M.KAP_HIER);
    const ra = new Float64Array(n), wa = new Float64Array(n);
    for (let u = 0; u < n; u++) { if (contou(u) && aa[u] > 0) { ra[u] = st.v[u] / Math.max(aa[u] * nc[u], 1); wa[u] = aa[u] / 100; } else { ra[u] = 1; wa[u] = 0; } }
    const e = M.pooled(U, ra, wa, M.KAP_NU);
    const porUF = {}, pu = new Float64Array(n);
    let PT = 0, ADV = 0, VAL = 0;
    for (let u = 0; u < n; u++) {
      const rem = Math.max(AA[u] - (contou(u) ? aa[u] : 0), 0) * nr[u] * e[u], p = ex(lg(rr[u]) + s[u]);
      const a = st.x[u] + rem * p, b = st.y[u] + rem * (1 - p);
      PT += a; ADV += b; VAL += st.v[u] + rem;
      const g = porUF[U.uf[u]] || (porUF[U.uf[u]] = {pt: 0, adv: 0, val: 0});
      g.pt += a; g.adv += b; g.val += st.v[u] + rem;
      pu[u] = a + b > 0 ? a / (a + b) : NaN;
    }
    return {pt: PT, adv: ADV, val: VAL, l2: PT / (PT + ADV), porUF, pu};
  }

  // ---- faixa: erros do próprio modelo novo nas 6 noites (2022 e 2018 com ordem real; 2002–2014 aproximada) ----
  // erro na margem (projeção − final, pontos) em cada % de seções; b = contagem crua. Gerado no laboratório em 24/10/2026.
  const TESTE = {"pontos":[0.5,1,2,3,5,7.5,10,11,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,98],"m":{"eleitorado":[[0.698,1.757,1.35,1.055,0.137,-0.038,0.342,0.122,0.544,0.388,0.328,0.145,0.074,0.025,-0.013,-0.127,-0.167,-0.183,-0.132,-0.157,-0.087,-0.011,-0.008,0.01,0.003,0.003],[4.804,5.458,5.156,3.382,4.055,3.76,3.074,2.543,2.519,2.429,1.816,1.586,1.416,1.099,0.949,0.777,0.592,0.737,0.635,0.557,0.572,0.48,0.334,0.192,0.075,0.018],[2.635,3.416,3.346,2.801,1.107,-0.167,0.43,-0.052,0.114,-0.1,-0.111,-0.148,-0.213,-0.043,-0.036,-0.014,-0.035,-0.036,0.036,0.024,0.03,0.023,0.015,0.039,0.032,0.045],[-4.665,-2.084,0.27,0.551,-0.397,-1.172,-0.412,-0.806,-0.796,-0.705,-0.667,-0.678,-0.736,-0.537,-0.508,-0.409,-0.344,-0.359,-0.283,-0.251,-0.211,-0.139,-0.093,-0.041,0.004,0.01],[-6.87,-3.248,-1.106,-0.646,-1.46,-1.491,-1.51,-2.019,-1.6,-1.218,-1.222,-1.186,-1.255,-0.922,-0.875,-0.77,-0.627,-0.678,-0.532,-0.453,-0.407,-0.302,-0.209,-0.09,-0.015,0.018],[-5.634,-3.322,0.021,1.263,0.845,0.827,0.08,0.038,0.093,0.131,0.196,0.069,0.042,0.169,0.139,-0.029,-0.003,-0.129,-0.083,-0.112,-0.141,-0.111,-0.068,-0.034,-0.003,-0.008]],"secoes":[[0.684,1.782,1.55,1.383,0.783,0.553,0.889,0.633,1.02,0.834,0.779,0.554,0.528,0.403,0.315,0.19,0.121,0.071,0.108,0.047,0.063,0.104,0.089,0.08,0.037,0.017],[4.576,5.522,5.31,3.871,4.604,4.342,3.643,3.221,3.241,3.007,2.334,2.042,1.848,1.598,1.42,1.203,0.965,1.067,0.918,0.81,0.788,0.647,0.459,0.277,0.136,0.028],[2.647,2.963,2.743,2.501,1.12,-0.047,0.538,0.169,0.319,0.13,0.049,0.049,-0.008,0.115,0.143,0.172,0.152,0.098,0.168,0.144,0.121,0.119,0.077,0.077,0.043,0.05],[-4.718,-2.104,0.016,0.411,-0.552,-1.184,-0.344,-0.673,-0.619,-0.58,-0.528,-0.536,-0.608,-0.419,-0.401,-0.303,-0.231,-0.252,-0.198,-0.193,-0.176,-0.086,-0.065,-0.025,0.007,0.013],[-6.82,-3.411,-1.271,-0.712,-1.457,-1.413,-1.338,-1.851,-1.481,-1.07,-1.088,-1.097,-1.159,-0.844,-0.784,-0.693,-0.527,-0.609,-0.478,-0.41,-0.381,-0.258,-0.18,-0.075,-0.013,0.022],[-5.517,-3.318,0.039,1.315,0.932,0.971,0.07,0.072,0.074,0.138,0.199,0.104,-0.02,0.123,0.135,-0.032,-0.002,-0.147,-0.096,-0.112,-0.145,-0.107,-0.056,-0.034,-0.006,-0.004]]},"b":[[-12.362,-14.506,-14.988,-12.422,-8.375,-6.952,-5.85,-5.545,-5.012,-4.914,-4.323,-3.915,-3.461,-3.083,-2.817,-2.412,-2.224,-2.046,-1.875,-1.697,-1.466,-1.229,-0.97,-0.739,-0.485,-0.258],[-6.651,-8.76,-19.688,-14.431,-9.635,-13.327,-8.632,-9.639,-5.454,-4.64,-4.751,-4.085,-2.157,-3.181,-2.764,-2.011,-1.639,-1.535,-1.232,-1.58,-1.711,-1.455,-1.173,-0.664,-0.911,-0.472],[-31.058,-26.52,-21.671,-16.495,-10.022,-7.37,-5.947,-5.88,-5.067,-4.64,-4.237,-4.078,-3.489,-3.188,-2.803,-2.372,-2.097,-1.993,-1.77,-1.585,-1.335,-1.022,-0.772,-0.525,-0.29,-0.144],[-14.778,-13.865,-11.393,-8.914,-6.12,-5.853,-5.559,-5.589,-5.711,-5.697,-5.402,-5.282,-4.743,-4.306,-3.917,-3.401,-2.976,-2.759,-2.404,-2.118,-1.749,-1.373,-1.049,-0.693,-0.374,-0.178],[-14.562,-13.173,-9.661,-7.361,-4.044,-4.072,-4.406,-4.548,-4.463,-4.573,-4.287,-4.277,-3.952,-3.583,-3.198,-2.789,-2.385,-2.282,-2.111,-1.839,-1.499,-1.282,-0.938,-0.653,-0.378,-0.193],[1.334,-0.332,-0.506,-0.851,-1.952,-3.416,-3.777,-4.061,-4.273,-4.299,-3.883,-3.708,-3.443,-3.1,-2.634,-2.011,-1.633,-1.297,-0.95,-0.648,-0.509,-0.21,-0.042,0.097,0.118,0.035]],"noites":["2º turno 2022 (ordem real)","2º turno 2018 (ordem real)","2º turno 2014","2º turno 2010","2º turno 2006","2º turno 2002"]};
  function montarSigma(listas) {
    const X = TESTE.pontos;
    const RMS = X.map((_, i) => Math.sqrt(listas.reduce((s, l) => s + l[i] ** 2, 0) / listas.length));
    const bruto = p => {
      let r = RMS[RMS.length - 1];
      if (p <= X[0]) r = RMS[0];
      else for (let i = 1; i < X.length; i++) if (p <= X[i]) { const w = (p - X[i - 1]) / (X[i] - X[i - 1]); r = RMS[i - 1] + w * (RMS[i] - RMS[i - 1]); break; }
      return Math.max(0.15, 1.5 * r);
    };
    return p => { if (p >= 99.999) return 0; let s = bruto(p); for (const q of X) if (q >= p) s = Math.max(s, bruto(q)); return FATOR * s; };
  }
  const SIG = {};
  function sigma(pct, modo) {
    const k = modo === 'secoes' ? 'secoes' : 'eleitorado';
    if (!TESTE.pontos.length) return M.sigma(pct);
    return (SIG[k] || (SIG[k] = montarSigma(TESTE.m[k])))(pct);
  }
  function avaliar(pl2, pct, modo) {
    const sig = sigma(pct, modo);
    const m2 = 100 - 2 * pl2;
    const chAdv = sig === 0 ? (m2 > 0 ? 1 : m2 < 0 ? 0 : 0.5) : M.Phi(m2 / sig);
    const pronto = pct >= 0.5;
    const lider = m2 > 0 ? 'adv' : 'lula';
    const ch = Math.max(chAdv, 1 - chAdv);
    let status = 'aguardando';
    if (pronto) status = ch < 0.9 ? 'empate' : ch < 0.99 ? 'vantagem' : 'vence';
    return {sig, m2, chAdv, lider, ch, pronto, status};
  }
  function definirTeste(t) { Object.assign(TESTE, t); for (const k in SIG) delete SIG[k]; }

  return {LAM, FATOR, montar, projetar, sigma, avaliar, TESTE, definirTeste, REG: M.REG};
});
