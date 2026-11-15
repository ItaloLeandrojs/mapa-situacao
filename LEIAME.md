# Mapa de situação

Site que lê o arquivo KML ou KMZ do Google Earth e devolve o mapa de situação (sem escala) em DXF, pronto para colar no quadro da prancha. Obras no Ceará.

Site: https://italoleandrojs.github.io/mapa-situacao/

O KML nunca sai do navegador: a base de estradas e cidades já vem com o site, nada é enviado para servidor.

## Como usar

1. No Google Earth, marque o local da obra com um alfinete que tenha a palavra OBRA no nome (por exemplo `LOCAL DA OBRA`) e trace a rota até ele. Trecho de terra que não aparece no mapa pode ser riscado à mão com "Adicionar caminho".
2. Salve a pasta como KML ou KMZ.
3. Abra o site e solte o arquivo na tela (ou use **Abrir**). Se o site escolher o alfinete errado, troque em **Local da obra**.
4. Confira a área proposta e ajuste se precisar: **Afastar** e **Aproximar**, arraste o mapa para mover a área, arraste um texto para mudar o lugar dele, ligue ou desligue cidades.
5. Clique em **Baixar DXF** e cole o desenho no quadro do mapa de situação da prancha (124,6 × 113 por padrão).

## Para quem mexe no código

- `npm install`: instala as dependências
- `npm run dev`: abre o site em modo de desenvolvimento
- `npm test`: roda os testes
- `npm run build`: confere os tipos e gera o site em `dist`
- `npm run base:baixar` e `npm run base:gerar`: refazem a base do Ceará em `public/base`

## Créditos

Dados de estradas © colaboradores do OpenStreetMap (ODbL). Nomes de municípios: IBGE.
