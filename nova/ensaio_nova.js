/*
 * Ensaio do /nova com a noite de 2022 já gravada para o /simulacao (os mesmos arquivos que o coletor
 * principal publicou, momento a momento). Não toca no site principal nem no TSE.
 *   node ensaio_nova.js [segundos_por_momento=6]
 * Liga um processo do modelo novo só para o ensaio (refs e ordem de chegada do 1º turno de 2022),
 * entrega os momentos um a um e compara, em cada um, o modelo novo e o atual com o resultado final.
 * Resultado em /opt/projecao/saida/nova_ensaio/ (o site mostra em /nova/?dados=nova_ensaio; o resumo
 * fica em /dados/nova_ensaio/resumo.json).
 * A gravação é de antes de o coletor mandar o eleitorado por cidade: o ensaio o reconstrói pelas seções
 * do 2º turno de 2022 (base/secoes_2022_2.json), exatamente como o servidor de ensaio o entregou.
 * ELEITORADO=0 roda sem ele (só pelo nº de seções).
 */
'use strict';
const fs = require('fs'), path = require('path'), {spawn} = require('child_process');
const P = '/opt/projecao';
const SEG = Math.max(2, Math.min(60, +(process.argv[2] || 6)));
const FOTOS = process.env.FOTOS || `${P}/site/simulacao/dados`;
const D = process.env.PASTA || `${P}/nova_ensaio`, ENT = `${D}/entrada`, EST = `${D}/estado`;
const SAI = process.env.SAIDA || `${P}/saida/nova_ensaio`;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const ler = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const gravar = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f); };
fs.rmSync(D, {recursive: true, force: true}); fs.rmSync(SAI, {recursive: true, force: true});
fs.mkdirSync(ENT, {recursive: true}); fs.mkdirSync(EST, {recursive: true}); fs.mkdirSync(SAI, {recursive: true});

const ind = ler(`${FOTOS}/indice.json`);
if (!ind || !ind.momentos || !ind.momentos.length) { console.error('sem a gravação do /simulacao'); process.exit(1); }
const fim = ler(`${FOTOS}/m/fim/nacional.json`) || ler(`${FOTOS}/m/${ind.momentos[ind.momentos.length - 1].id}/nacional.json`);
const lFinal = 100 * fim.br.A / (fim.br.A + fim.br.B), mFinal = 2 * lFinal - 100;

// eleitorado das seções apuradas em cada cidade, como o servidor de ensaio (replay.js) calcula: seções na ordem do arquivo
const COM_ELEITORADO = process.env.ELEITORADO !== '0';
let ELE = null;
if (COM_ELEITORADO) {
  const S = ler(`${P}/base/secoes_2022_2.json`);
  if (S && S.mun) {
    ELE = new Map();
    for (let i = 0; i < S.mun.length; i++) { const m = S.mun[i]; let g = ELE.get(m); if (!g) ELE.set(m, g = [0]); g.push(g[g.length - 1] + S.aptos[i]); }
  }
}
function comEleitorado(cid) {
  if (!ELE) return cid;
  return Object.assign({}, cid, {c: cid.c.map(r => { if (r.length >= 9) return r; const g = ELE.get(+r[0]); return g ? [...r, g[Math.min(+r[1], g.length - 1)], g[g.length - 1]] : [...r, 0, 0]; })});
}

const filho = spawn(process.execPath, [path.join(__dirname, 'nova.js')], {
  env: Object.assign({}, process.env, {ENTRADA: ENT, SAIDA: SAI, ESTADO: EST, REFS: `${P}/base/refs2022_t1.json`, CURVAS: `${P}/base/curvas_nova2022.json`, INTERVALO: '500'}),
  stdio: ['ignore', fs.openSync(`${D}/nova.log`, 'a'), fs.openSync(`${D}/nova.log`, 'a')]
});
const linhas = [];
const resumo = st => gravar(`${SAI}/resumo.json`, {situacao: st, segundosPorMomento: SEG, eleitorado: !!ELE, final: {l2: +lFinal.toFixed(3), margem: +mFinal.toFixed(3)}, momentos: linhas, conferido: new Date().toISOString()});
(async () => {
  try {
    resumo('começando');
    for (const mo of ind.momentos) {
      const dir = `${FOTOS}/m/${mo.id}`, t0 = Date.now();
      for (const f of ['ufs_hist.json', 'cidades.json', 'nacional.json']) {
        if (f === 'cidades.json') gravar(`${ENT}/${f}`, comEleitorado(ler(`${dir}/${f}`)));
        else { fs.copyFileSync(`${dir}/${f}`, `${ENT}/.${f}.tmp`); fs.renameSync(`${ENT}/.${f}.tmp`, `${ENT}/${f}`); }
      }
      let saida = null;
      for (let k = 0; k < 40; k++) { await dormir(500); const s = ler(`${SAI}/nacional.json`); if (s && s.nova && s.nova.calculadoEm >= t0) { saida = s; break; } }
      const at = ler(`${dir}/nacional.json`);
      const pn = saida && saida.proj, pa = at && at.proj;
      linhas.push({id: mo.id, hg: mo.hg, pct: pn ? pn.pct : null,
        nova: pn && pn.l2 != null ? {l2: pn.l2, erro: +(2 * pn.l2 - 100 - mFinal).toFixed(3), faixa: +(1.96 * pn.sig).toFixed(3), status: pn.status, lider: pn.lider, modo: saida.nova.modo} : null,
        atual: pa && pa.l2 != null ? {l2: pa.l2, erro: +(2 * pa.l2 - 100 - mFinal).toFixed(3), faixa: +(1.96 * pa.sig).toFixed(3), status: pa.status, lider: pa.lider} : null});
      resumo('rodando');
      await dormir(Math.max(0, SEG * 1000 - (Date.now() - t0)));
    }
    resumo('pronto');
  } catch (e) { resumo('erro: ' + (e && e.message || e)); }
  finally { filho.kill(); }
})();
