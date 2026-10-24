/*
 * Gravador da noite de domingo: guarda fotos do que o site principal e o /nova publicam, para a análise
 * de segunda (onde a projeção errou: Brasil, regiões, estados e cidades, hora a hora).
 * Só lê arquivos; não pede nada ao TSE e não muda nenhum site.
 *   - espera a apuração começar (Brasil com seções apuradas) e só grava o modo ao vivo (ensaio não);
 *   - foto a cada 2 min das 17h às 20h, a cada 5 min até 23h, a cada 15 min depois, e também a cada
 *     1% apurado a mais (com pelo menos 30 s entre fotos); para 1 h depois de 100% ou na segunda às 6h;
 *   - cada foto: nacional.json e cidades.json do principal e do /nova, e ufs_hist.json (tudo em .gz);
 *   - grava em /opt/projecao/saida/noite (lido em /dados/noite/); índice em indice.json e situação em situacao.json.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const P = '/opt/projecao';
const CFG = {
  principal: process.env.PRINCIPAL || `${P}/saida`,
  nova: process.env.NOVA || `${P}/saida/nova`,
  destino: process.env.DESTINO || `${P}/saida/noite`,
  ate: +(process.env.ATE || Date.parse('2026-10-26T09:00:00Z')),     // segunda, 6h de Brasília
  escala: +(process.env.ESCALA || 1),                                 // só para teste (encurta os intervalos)
  aceitarEnsaio: process.env.ACEITAR_ENSAIO === '1'
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const ler = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const gravarJSON = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f); };
const brasilia = ms => new Date(ms - 3 * 3600000).toISOString().slice(11, 19);
function intervalo(ms) {
  const h = brasilia(ms), min = +h.slice(0, 2) * 60 + +h.slice(3, 5);
  const base = min >= 17 * 60 && min < 20 * 60 ? 120000 : min >= 20 * 60 && min < 23 * 60 ? 300000 : 900000;
  return base * CFG.escala;
}
function livreMB() { try { const s = fs.statfsSync(CFG.destino); return s.bavail * s.bsize / 1e6; } catch (e) { return Infinity; } }

fs.mkdirSync(path.join(CFG.destino, 'm'), {recursive: true});
const IND = path.join(CFG.destino, 'indice.json');
const ind = ler(IND) || {inicio: Date.now(), momentos: []};
let em100 = ind.momentos.length && ind.momentos[ind.momentos.length - 1].pct >= 100 ? ind.momentos[ind.momentos.length - 1].t : 0;
let situacaoTxt = '';
function situacao(txt) {
  situacaoTxt = txt;
  const u = ind.momentos[ind.momentos.length - 1];
  try { gravarJSON(path.join(CFG.destino, 'situacao.json'), {situacao: txt, fotos: ind.momentos.length, ultima: u || null, livreMB: Math.round(livreMB()), conferido: new Date().toISOString()}); } catch (e) {}
}
const resumoProj = n => n && n.proj && n.proj.l2 != null ? {l2: n.proj.l2, sig: n.proj.sig, status: n.proj.status, lider: n.proj.lider, pct: n.proj.pct} : null;

function foto(n, pct, agora) {
  const id = String(ind.momentos.length).padStart(4, '0'), dir = path.join(CFG.destino, 'm', id);
  fs.mkdirSync(dir, {recursive: true});
  let bytes = 0;
  const copiar = (origem, nome) => { try { const b = zlib.gzipSync(fs.readFileSync(origem), {level: 6}); fs.writeFileSync(path.join(dir, nome + '.gz'), b); bytes += b.length; return true; } catch (e) { return false; } };
  copiar(path.join(CFG.principal, 'nacional.json'), 'principal_nacional.json');
  copiar(path.join(CFG.principal, 'cidades.json'), 'principal_cidades.json');
  copiar(path.join(CFG.principal, 'ufs_hist.json'), 'ufs_hist.json');
  const temNova = copiar(path.join(CFG.nova, 'nacional.json'), 'nova_nacional.json');
  copiar(path.join(CFG.nova, 'cidades.json'), 'nova_cidades.json');
  const nn = temNova ? ler(path.join(CFG.nova, 'nacional.json')) : null;
  ind.momentos.push({id, t: agora, hb: brasilia(agora), hg: n.tse && n.tse.hg || null, pct: +pct.toFixed(3), principal: resumoProj(n), nova: resumoProj(nn), kb: Math.round(bytes / 1000)});
  gravarJSON(IND, ind);
  log('foto', id, brasilia(agora), pct.toFixed(2) + '%', Math.round(bytes / 1000) + ' kB');
}

(async () => {
  log('gravador da noite ligado; grava em', CFG.destino, 'até', new Date(CFG.ate).toISOString());
  for (;;) {
    const agora = Date.now();
    if (agora > CFG.ate) { situacao('encerrado (horário limite)'); log('fim do horário'); break; }
    try {
      const n = ler(path.join(CFG.principal, 'nacional.json'));
      if (!n || !n.br || !(n.br.ts > 0)) situacao('aguardando o site principal');
      else if (n.ensaio && !CFG.aceitarEnsaio) situacao('ensaio no ar: não grava');
      else if (!(n.br.st > 0)) situacao('aguardando a apuração começar');
      else if (livreMB() < 500) situacao('parado: disco quase cheio');
      else {
        const pct = 100 * n.br.st / n.br.ts, u = ind.momentos[ind.momentos.length - 1];
        const passou = u ? agora - u.t : Infinity;
        const devida = !u || passou >= intervalo(agora) || (Math.floor(pct) > Math.floor(u.pct) && passou >= 30000 * CFG.escala) || (pct >= 100 && u.pct < 100);
        if (devida) foto(n, pct, agora);
        if (pct >= 100 && !em100) em100 = agora;
        if (em100 && agora - em100 > 3600000 * CFG.escala) {
          if (ind.momentos[ind.momentos.length - 1].t < agora - 1000) foto(n, pct, agora);
          situacao('encerrado: apuração completa'); log('apuração completa: encerrado'); break;
        }
        situacao('gravando');
      }
    } catch (e) { situacao('erro: ' + (e && e.message || e)); }
    await new Promise(r => setTimeout(r, Math.max(500, 5000 * Math.min(1, CFG.escala * 10))));
  }
})();
