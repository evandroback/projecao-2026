#!/usr/bin/env bash
# Grava a noite de 2022 para a linha do tempo do /simulacao.
#   gravar_simulacao.sh [velocidade]   (padrão 10: a noite inteira em uns 50 minutos)
# Roda um servidor de ensaio e um coletor à parte (porta 8082, pasta /opt/projecao/gravacao) e guarda fotos
# dos números ao longo da noite. O coletor ao vivo e o site de domingo não são tocados.
# Só no fim, e só se a gravação estiver completa, troca os dados do /simulacao. Situação em /dados/gravacao.json.
set -uo pipefail
P=/opt/projecao
VEL=${1:-10}; [[ "$VEL" =~ ^[0-9]{1,2}$ ]] && [ "$VEL" -ge 1 ] || VEL=10
G=$P/gravacao
RP=; CO=
limpar() { [ -n "$CO" ] && kill "$CO" 2>/dev/null; [ -n "$RP" ] && kill "$RP" 2>/dev/null; true; }
trap limpar EXIT
rm -rf "$G" && mkdir -p "$G/saida" "$G/estado" "$G/fotos"
node $P/app/replay.js --secoes $P/base/secoes_2022_2.json --porta 8082 --velocidade "$VEL" --inicio -3 > "$G/replay.log" 2>&1 & RP=$!
sleep 3
TSE_BASE=http://127.0.0.1:8082 ANO=2026 ELEICAO=6258 REFS=$P/base/refs2022_t1.json SAIDA=$G/saida ESTADO=$G/estado \
ENSAIO="reprise do 2º turno de 2022" TAXA=300 CONCORRENCIA=24 ACELERAR="$VEL" node $P/app/coletor.js > "$G/coletor.log" 2>&1 & CO=$!
node $P/app/gravar_fotos.js "$G/saida" "$G/fotos" 120 "$P/saida/gravacao.json" > "$G/fotos.log" 2>&1
n=$(node -e 'try{console.log(require(process.argv[1]).momentos.length)}catch(e){console.log(0)}' "$G/fotos/indice.json")
if [ "$n" -lt 20 ]; then echo "gravação incompleta ($n momentos): /simulacao continua como estava"; exit 1; fi
D=$P/site/simulacao/dados; N=$P/site/simulacao/dados.novo
rm -rf "$N" && cp -a "$G/fotos" "$N"
ult=$(node -e 'const i=require(process.argv[1]);console.log(i.momentos[i.momentos.length-1].id)' "$N/indice.json")
cp "$N/m/$ult/"*.json "$N/"                     # o último momento também fica na raiz (é o que abre primeiro)
rm -rf "$D.velho"; [ -d "$D" ] && mv "$D" "$D.velho"; mv "$N" "$D"
echo "simulação gravada: $n momentos"
