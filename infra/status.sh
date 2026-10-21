#!/usr/bin/env bash
# Mostra, em português, como estão o coletor, o site e os números publicados.
P=/opt/projecao
echo "serviços: coletor=$(systemctl is-active projecao-coletor) · ensaio=$(systemctl is-active projecao-ensaio) · site=$(systemctl is-active caddy)"
echo "modo: $(grep -q '^ENSAIO=.\+' $P/coletor.env && grep '^ENSAIO=' $P/coletor.env | cut -d= -f2- || echo 'AO VIVO (TSE)')"
echo
node -e '
const fs = require("fs");
try {
  const n = JSON.parse(fs.readFileSync("/opt/projecao/saida/nacional.json", "utf8"));
  const idade = s => Math.round((Date.now() - s) / 1000) + " s atrás";
  const br = n.br || {}, p = n.proj || {};
  console.log("publicado:", idade(n.gerado), "· status:", n.status, "· TSE gerou às", (n.tse || {}).hg || "—");
  console.log("TSE lido com sucesso:", n.saude.ultimoOk ? idade(n.saude.ultimoOk) : "nunca", "· erros:", n.saude.erros, n.saude.ultimoErro || "", "· ritmo", n.saude.ritmo, "pedidos/s");
  console.log("Brasil:", br.ts ? (100 * br.st / br.ts).toFixed(2) + "% das urnas" : "—", br.A + br.B > 0 ? "· Lula " + (100 * br.A / (br.A + br.B)).toFixed(2) + "% (só os dois)" : "");
  console.log("Projeção:", p.pronto ? "Lula " + p.l2 + "% · " + p.status + " · chance do líder " + (100 * Math.max(p.chAdv, 1 - p.chAdv)).toFixed(1) + "%" : (p.status || "—"));
  if (n.cravou) console.log("Cravou:", n.cravou.lider, "às", n.cravou.hg || new Date(n.cravou.t).toISOString(), "com", n.cravou.pct + "%");
} catch (e) { console.log("ainda sem nacional.json:", e.message); }
'
echo
echo "últimas linhas do coletor:"
journalctl -u projecao-coletor -n 8 --no-pager -o cat 2>/dev/null || sudo journalctl -u projecao-coletor -n 8 --no-pager -o cat
