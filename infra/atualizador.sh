#!/usr/bin/env bash
# Atualizador da Projeção 2026 — roda a cada minuto (projecao-atualizador.timer).
# Busca o repositório público github.com/evandroback/projecao-2026. Se houver versão nova:
#   1) testa os arquivos (JavaScript e scripts); se algo estiver quebrado, não instala nada;
#   2) guarda uma cópia do que está no ar em /opt/projecao/backup-auto;
#   3) instala; só reinicia o coletor se o código dele mudou.
# Depois aplica o pedido da 1ª linha de controle.txt, se mudou. Pedidos aceitos (nada além disso):
#   nada | ao_vivo | ensaio 2022|2026 [velocidade] [inicio] | reconstruir_base | voltar_backup
#   (para repetir o mesmo pedido, acrescente uma marca no fim, ex.: "ensaio 2022 4 -3 v2")
# Publica a situação em /dados/atualizador.json.
# Desligar: sudo systemctl disable --now projecao-atualizador.timer   (desliga sozinho depois de 27/10/2026)
set -uo pipefail
P=${P:-/opt/projecao}
REPO_URL=${REPO_URL:-https://github.com/evandroback/projecao-2026.git}
SUDO=${SUDO-sudo}
R=$P/repo
E=$P/estado
LOG=$P/atualizador.log
mkdir -p "$E" "$P/saida"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
situacao() {
  local tmp="$P/saida/.atualizador.json.tmp"
  printf '{"versao":"%s","instalada_em":"%s","resultado":"%s","pedido_aplicado":"%s","conferido_em":"%s"}\n' \
    "$(cat "$E/versao-instalada" 2>/dev/null)" "$(cat "$E/instalada-em" 2>/dev/null)" "$1" \
    "$(cat "$E/controle-aplicado" 2>/dev/null)" "$(date -u +%FT%TZ)" > "$tmp" && mv "$tmp" "$P/saida/atualizador.json"
}

# depois da eleição, desliga sozinho
if [ "$(date +%Y%m%d)" -gt 20261027 ]; then
  log "fim do período: desligando o atualizador"
  $SUDO systemctl disable --now projecao-atualizador.timer
  exit 0
fi

if [ ! -d "$R/.git" ]; then
  git clone -q --depth 1 "$REPO_URL" "$R" 2>>"$LOG" || { log "não consegui baixar o repositório"; situacao erro_github; exit 0; }
fi
if ! git -C "$R" fetch -q --depth 1 origin main 2>>"$LOG"; then situacao erro_github; exit 0; fi
NOVO=$(git -C "$R" rev-parse FETCH_HEAD)
ATUAL=$(cat "$E/versao-instalada" 2>/dev/null || echo nenhuma)
RECUSADA=$(cat "$E/versao-recusada" 2>/dev/null || echo nenhuma)
RES=ok

if [ "$NOVO" != "$ATUAL" ] && [ "$NOVO" != "$RECUSADA" ]; then
  git -C "$R" reset -q --hard FETCH_HEAD
  ok=1
  for f in "$R"/coletor/*.js; do node --check "$f" 2>>"$LOG" || ok=0; done
  for f in "$R"/infra/*.sh; do bash -n "$f" 2>>"$LOG" || ok=0; done
  for f in site/index.html site/simulacao/index.html site/estatico/modelo.js site/estatico/mapas/br.json; do [ -s "$R/$f" ] || ok=0; done
  if [ $ok = 1 ]; then
    rm -rf "$P/backup-auto" && mkdir -p "$P/backup-auto" && cp -a "$P/app" "$P/site" "$P/backup-auto/"
    mudou_coletor=0
    for f in "$R"/coletor/*.js; do cmp -s "$f" "$P/app/$(basename "$f")" || mudou_coletor=1; done
    cp "$R"/coletor/*.js "$P/app/"
    cp "$R/site/index.html" "$P/site/index.html"
    cp "$R/site/simulacao/index.html" "$P/site/simulacao/index.html"
    cp "$R/site/estatico/modelo.js" "$P/site/estatico/modelo.js"
    cp "$R/site/estatico/mapas/br.json" "$P/site/estatico/mapas/br.json"
    cp "$R/infra/ensaio.sh" "$R/infra/ao_vivo.sh" "$R/infra/status.sh" "$P/"
    # o próprio atualizador: copia e renomeia (a execução atual não é afetada)
    cp "$R/infra/atualizador.sh" "$P/.atualizador.novo" && chmod +x "$P/.atualizador.novo" && mv "$P/.atualizador.novo" "$P/atualizador.sh"
    if [ $mudou_coletor = 1 ]; then $SUDO systemctl restart projecao-coletor; fi
    echo "$NOVO" > "$E/versao-instalada"; date '+%F %T' > "$E/instalada-em"; rm -f "$E/versao-recusada"
    log "instalada a versão ${NOVO:0:7} (coletor reiniciado: $mudou_coletor)"
  else
    RES=erro_teste
    echo "$NOVO" > "$E/versao-recusada"
    log "versão ${NOVO:0:7} tem erro: NÃO instalada; continua a ${ATUAL:0:7}"
  fi
elif [ "$NOVO" = "$RECUSADA" ]; then
  RES=erro_teste
fi

# pedido de controle (só os verbos combinados; o texto é filtrado antes)
PEDIDO=$(head -n1 "$R/controle.txt" 2>/dev/null | tr -cd 'a-z0-9 ._-' | tr -s ' ' | sed 's/^ //; s/ $//')
FEITO=$(cat "$E/controle-aplicado" 2>/dev/null)
if [ -n "$PEDIDO" ] && [ "$PEDIDO" != "$FEITO" ] && [ "$RES" = ok ]; then
  read -r verbo a1 a2 a3 _ <<< "$PEDIDO"
  [[ "${a2:-}" =~ ^[0-9]{1,3}$ ]] || a2=4
  [[ "${a3:-}" =~ ^-?[0-9]{1,4}$ ]] || a3=-3
  case "$verbo" in
    nada) ;;
    ao_vivo) bash "$P/ao_vivo.sh" >> "$LOG" 2>&1 ;;
    ensaio)
      case "${a1:-}" in
        2022|2026) bash "$P/ensaio.sh" "$a1" "$a2" "$a3" >> "$LOG" 2>&1 ;;
        *) log "pedido de ensaio sem ano válido: $PEDIDO" ;;
      esac ;;
    reconstruir_base) (cd "$P/app" && node --max-old-space-size=1536 preparar.js && node montar_site.js) >> "$LOG" 2>&1 || log "reconstruir_base falhou" ;;
    voltar_backup)
      if [ -d "$P/backup-auto/app" ]; then
        cp -a "$P/backup-auto/app/." "$P/app/" && cp -a "$P/backup-auto/site/." "$P/site/" && $SUDO systemctl restart projecao-coletor
      else log "não há cópia para voltar"; fi ;;
    *) log "pedido desconhecido: $PEDIDO" ;;
  esac
  echo "$PEDIDO" > "$E/controle-aplicado"
  log "pedido aplicado: $PEDIDO"
fi
situacao "$RES"
