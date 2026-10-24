#!/usr/bin/env bash
# Prepara e liga o /nova (modelo novo), sem tocar no site principal:
#   1) monta a ordem de chegada das urnas do 1º turno de 2026 (para domingo) e de 2022 (para o ensaio);
#   2) ensaio com a noite de 2022 já gravada para o /simulacao (resumo em /dados/nova_ensaio/resumo.json);
#   3) liga o processo do /nova lendo o que o coletor principal publica.
#   nova_preparar.sh [segundos_por_momento_do_ensaio=6]
# Situação em /dados/nova/preparo.json; conferência das curvas em /dados/nova/curvas_2026.json e curvas_2022.json.
set -uo pipefail
P=/opt/projecao
N=$P/nova
mkdir -p "$P/saida/nova"
sit() { printf '{"etapa":"%s","detalhe":"%s","em":"%s"}\n' "$1" "${2:-}" "$(date -u +%FT%TZ)" > "$P/saida/nova/.preparo.tmp" && mv "$P/saida/nova/.preparo.tmp" "$P/saida/nova/preparo.json"; }
sit "1/3 ordem de chegada" "2026"
if ! RESUMO=$P/saida/nova/curvas_2026.json node --max-old-space-size=1536 "$N/curvas_nova.js" 2026 >> "$N/preparo.log" 2>&1; then
  sit "erro" "ordem de chegada de 2026 falhou: veja $N/preparo.log"; exit 1
fi
sit "1/3 ordem de chegada" "2022"
if RESUMO=$P/saida/nova/curvas_2022.json node --max-old-space-size=1536 "$N/curvas_nova.js" 2022 >> "$N/preparo.log" 2>&1; then
  sit "2/3 ensaio com 2022" "rodando"
  node "$N/ensaio_nova.js" "${1:-6}" >> "$N/preparo.log" 2>&1 || true
else
  sit "2/3 ensaio com 2022" "pulado: sem a ordem de 2022"
fi
sit "3/3 ligando" ""
if bash "$N/nova_ligar.sh" >> "$N/preparo.log" 2>&1; then sit "pronto" "ligado"; else sit "erro" "não ligou: veja $N/preparo.log"; fi
