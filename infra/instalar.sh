#!/usr/bin/env bash
# Instala a Projeção da Apuração 2026 nesta VM (Ubuntu na Oracle). Pode rodar de novo sem estragar nada.
#   bash infra/instalar.sh                      # tudo
#   PULAR_DADOS=1 bash infra/instalar.sh        # só atualiza código e site (não baixa nem refaz os dados)
#   NOME=meusite.duckdns.org bash infra/instalar.sh   # outro endereço com HTTPS
set -euo pipefail
cd "$(dirname "$0")/.."                     # pasta do pacote (tem coletor/, site/, infra/)
PKG=$(pwd)
P=/opt/projecao
IP=${IP:-64.181.167.66}
NOME=${NOME:-$(echo "$IP" | tr . -).sslip.io}
APT="sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 -y -qq"
passo() { echo; echo "=== $* ==="; }

passo "1/8 pacotes do sistema (Node 22, Caddy, unzip)"
$APT update
$APT install unzip curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  $APT install nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $APT update && $APT install caddy >/dev/null
fi
echo "node $(node -v) · $(caddy version | cut -d' ' -f1)"

passo "2/8 memória de reserva (swap), se a VM tiver pouca RAM"
if ! swapon --show | grep -q . && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 4000 ]; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -m | awk '/Mem:|Swap:/{print $1, $2 " MB"}'

passo "3/8 pastas e código"
sudo mkdir -p $P && sudo chown ubuntu:ubuntu $P
mkdir -p $P/{app,site,saida,estado,base,brutos,ferramentas}
cp "$PKG"/coletor/*.js $P/app/
mkdir -p $P/site/estatico/mapas $P/site/simulacao
cp "$PKG"/site/index.html $P/site/
cp "$PKG"/site/simulacao/index.html $P/site/simulacao/
cp "$PKG"/site/estatico/modelo.js $P/site/estatico/
cp "$PKG"/site/estatico/mapas/br.json $P/site/estatico/mapas/
cp "$PKG"/infra/ensaio.sh "$PKG"/infra/ao_vivo.sh "$PKG"/infra/status.sh $P/ && chmod +x $P/*.sh
echo "código em $P/app, site em $P/site"

passo "4/8 firewall da própria VM (portas 80 e 443)"
for porta in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $porta -m state --state NEW -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport $porta -m state --state NEW -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null 2>&1 || true
else echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | sudo debconf-set-selections; $APT install iptables-persistent >/dev/null; fi
echo "portas 80 e 443 liberadas na VM (falta liberar também na Oracle: Security List)"

if [ "${PULAR_DADOS:-0}" != "1" ]; then
  passo "5/8 dados abertos do TSE (≈850 MB, só na primeira vez)"
  cd $P/brutos
  for f in detalhe_votacao_secao/detalhe_votacao_secao_2026.zip votacao_secao/votacao_secao_2026_BR.zip \
           detalhe_votacao_secao/detalhe_votacao_secao_2022.zip votacao_secao/votacao_secao_2022_BR.zip; do
    n=$(basename $f)
    if [ -s "$n" ] && unzip -tq "$n" >/dev/null 2>&1; then echo "já tenho $n"; continue; fi
    echo "baixando $n…"
    curl -fL --retry 5 --retry-delay 5 -C - -o "$n.parcial" "https://cdn.tse.jus.br/estatistica/sead/odsele/$f"
    mv "$n.parcial" "$n"
  done
  ls -la $P/brutos

  passo "6/8 referências do 1º turno de 2026 e de 2022 (leva alguns minutos)"
  cd $P/app
  node --max-old-space-size=1536 preparar.js

  passo "7/8 base do site e mapas por município"
  node montar_site.js
  if [ ! -d $P/ferramentas/node_modules/mapshaper ]; then (cd $P/ferramentas && npm init -y >/dev/null && npm install --silent --no-audit --no-fund mapshaper@0.6 d3-geo@3 >/dev/null); fi
  FERR=$P/ferramentas node montar_mapas.js
fi

passo "8/8 serviços (coletor e site)"
sudo cp "$PKG"/infra/projecao-coletor.service "$PKG"/infra/projecao-ensaio.service "$PKG"/infra/projecao-ao-vivo.service "$PKG"/infra/projecao-ao-vivo.timer /etc/systemd/system/
[ -f $P/coletor.env ] || bash $P/ao_vivo.sh --so-config
[ -f $P/ensaio.env ] || printf 'SECOES=%s\nVELOCIDADE=4\nINICIO=-3\n' "$P/base/secoes_2022_2.json" > $P/ensaio.env
sudo systemctl daemon-reload
sudo systemctl enable projecao-coletor >/dev/null 2>&1
sudo systemctl enable --now projecao-ao-vivo.timer >/dev/null 2>&1 || echo "AVISO: não consegui ligar o despertador do modo ao vivo"
# atualizador: a VM busca as versões novas no GitHub público (evandroback/projecao-2026) a cada minuto
if [ "${SEM_ATUALIZADOR:-0}" != "1" ]; then
  command -v git >/dev/null || $APT install git >/dev/null
  cp "$PKG"/infra/atualizador.sh $P/ && chmod +x $P/atualizador.sh
  sudo cp "$PKG"/infra/projecao-atualizador.service "$PKG"/infra/projecao-atualizador.timer /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now projecao-atualizador.timer >/dev/null 2>&1 || echo "AVISO: não consegui ligar o atualizador"
fi
sudo systemctl restart projecao-coletor
sed -e "s/NOME_DO_SITE/$NOME/g" -e "s/IP_DO_SITE/$IP/g" "$PKG"/infra/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
sudo systemctl enable caddy >/dev/null 2>&1
sudo systemctl reload caddy || sudo systemctl restart caddy
sleep 3
systemctl is-active projecao-coletor caddy || true
echo
echo "Pronto. Endereços: https://$NOME · https://$IP (certificado de IP) · http://$IP"
echo "Os certificados HTTPS podem levar alguns minutos; acompanhe: sudo journalctl -u caddy -f"
echo "Situação a qualquer momento: /opt/projecao/status.sh"
