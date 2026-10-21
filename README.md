# Projeção da Apuração 2026

Site e coletor da projeção ao vivo do 2º turno presidencial de 2026 (Lula × Flávio Bolsonaro),
calculada a partir dos resultados oficiais do TSE, cidade por cidade.

Site: https://64-181-167-66.sslip.io · simulação: https://64-181-167-66.sslip.io/simulacao

## Pastas
- `coletor/` — lê o TSE, calcula a projeção (`modelo.js`) e publica os números; prepara os dados abertos (`preparar.js`).
- `site/` — página do site e simulação.
- `infra/` — instalação na VM da Oracle, servidor web (Caddy), serviços e o atualizador.

## Como as mudanças chegam ao servidor
A VM confere este repositório a cada minuto (`infra/atualizador.sh`). Quando há versão nova, ela testa
os arquivos antes; se algo estiver quebrado, não instala e fica com a versão anterior. A situação fica em
`https://64-181-167-66.sslip.io/dados/atualizador.json`.

## `controle.txt`
A primeira linha é um pedido para a VM. Só estes são aceitos:
`nada` · `ao_vivo` · `ensaio 2022 4 -3` · `ensaio 2026 4 -3` · `reconstruir_base` · `voltar_backup`.
Para repetir o mesmo pedido, acrescente uma marca no fim (ex.: `ensaio 2022 4 -3 v2`).

O atualizador se desliga sozinho depois de 27/10/2026. Para desligar antes, na VM:
`sudo systemctl disable --now projecao-atualizador.timer`.

Projeção estatística independente; não é pesquisa eleitoral e não substitui o resultado oficial do TSE.
