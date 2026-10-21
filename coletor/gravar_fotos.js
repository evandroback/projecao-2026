// Grava fotos dos números de um ensaio, para a linha do tempo do /simulacao (infra/gravar_simulacao.sh).
//   node gravar_fotos.js SAIDA_DO_COLETOR PASTA_FOTOS [limite_em_minutos_reais=120] [arquivo_de_situacao]
// Uma foto a cada 5 minutos da noite até as 20h, a cada 15 até as 22h e a cada 30 depois; e uma no fim.
'use strict';
const fs = require('fs'), path = require('path');
const [SAIDA, FOTOS, LIMITE = '120', SITUACAO = ''] = process.argv.slice(2);
const limite = +LIMITE * 60000, t0 = Date.now();
const ARQS = ['nacional.json', 'cidades.json', 'ufs_hist.json'];
const passo = m => m < 180 ? 5 : m < 300 ? 15 : 30;
const minDeHora = hg => { let m = (+hg.slice(0, 2)) * 60 + (+hg.slice(3, 5)) - 17 * 60; if (m < -660) m += 1440; return m; };
const ler = f => { try { return JSON.parse(fs.readFileSync(path.join(SAIDA, f), 'utf8')); } catch (e) { return null; } };
const dormir = ms => new Promise(r => setTimeout(r, ms));
const momentos = [];
let proximo = 5;   // primeira foto às 17h05
fs.mkdirSync(path.join(FOTOS, 'm'), {recursive: true});

function situacao(txt) {
  if (!SITUACAO) return;
  const u = momentos[momentos.length - 1];
  try { fs.writeFileSync(SITUACAO + '.tmp', JSON.stringify({situacao: txt, momentos: momentos.length, ultimo: u || null, conferido: new Date().toISOString()})); fs.renameSync(SITUACAO + '.tmp', SITUACAO); } catch (e) {}
}
function foto(n, id, m) {
  const dir = path.join(FOTOS, 'm', id);
  fs.mkdirSync(dir, {recursive: true});
  for (const f of ARQS) { try { fs.copyFileSync(path.join(SAIDA, f), path.join(dir, f)); } catch (e) {} }
  momentos.push({id, m, hg: n.tse.hg.slice(0, 5), pct: +(100 * n.br.st / n.br.ts).toFixed(2)});
  fs.writeFileSync(path.join(FOTOS, 'indice.json'), JSON.stringify({gerado: Date.now(), momentos}));
  console.log(new Date().toTimeString().slice(0, 8), 'foto', id, n.tse.hg, momentos[momentos.length - 1].pct + '%');
  situacao('gravando');
}

(async () => {
  situacao('começando');
  for (;;) {
    await dormir(1000);
    if (Date.now() - t0 > limite) { console.log('tempo esgotado'); situacao('tempo esgotado'); break; }
    const n = ler('nacional.json');
    if (!n || !n.br || !n.tse || !n.tse.hg || !(n.br.ts > 0) || !(n.br.st > 0)) continue;
    const m = minDeHora(n.tse.hg);
    if (n.br.st >= n.br.ts) {
      await dormir(20000);                       // deixa o coletor terminar de ler as cidades
      const f = ler('nacional.json') || n;
      foto(f, 'fim', minDeHora(f.tse.hg));
      console.log('apuração completa'); situacao('completa');
      break;
    }
    if (m >= proximo) {
      let mk = proximo;                          // a marca de horário mais recente já alcançada
      while (mk + passo(mk) <= m) mk += passo(mk);
      foto(n, String(mk).padStart(4, '0'), mk);
      proximo = mk + passo(mk);
    }
  }
})();
