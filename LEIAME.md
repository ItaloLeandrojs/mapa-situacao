# Mapa de situação

Site que lê o arquivo KML ou KMZ do Google Earth e devolve o mapa de situação (sem escala) em DXF, pronto para colar no quadro da prancha. Obras no Ceará.

Site: https://italoleandrojs.github.io/mapa-situacao/

O KML nunca sai do navegador: a base de estradas e cidades já vem com o site, nada é enviado para servidor.

## Como usar

1. No Google Earth, marque o local da obra com um alfinete que tenha a palavra OBRA no nome (por exemplo `LOCAL DA OBRA`) e trace a rota até ele. Trecho de terra que não aparece no mapa pode ser riscado à mão com "Adicionar caminho".
2. Salve a pasta como KML ou KMZ.
3. Abra o site e solte o arquivo na tela (ou use **Abrir**). Se o site escolher o alfinete errado, troque em **Local da obra**.
4. Confira a área proposta e ajuste se precisar: **Afastar** e **Aproximar**, arraste o mapa para mover a área, arraste um texto para mudar o lugar dele, ligue ou desligue cidades.
5. Quando a obra fica longe da rodovia, num caminho de terra, o mapa ganha o **Detalhe da chegada**: um quadrinho num canto, com a rodovia, as estradinhas, o caminho até a obra, a entrada e as viradas onde dá para errar. Para a obra na beira da rodovia, não tem detalhe.
   - O caminho vem do trecho de terra que você riscou no Google Earth. Se você não riscou, o site sugere um caminho pelas estradinhas do OpenStreetMap: ele aparece só na prévia e pede **Aceitar** ou **Recusar**. O que não for aceito não vai para o DXF.
   - Em **Detalhe da chegada**, escolha o canto do quadrinho (ou deixe em **Automático**), use **Afastar**, **Aproximar** e **Proposta** para a área dele, e arraste dentro do quadrinho para mover a área.
   - Cada virada ganha uma coordenada. Desligue as que não quiser, e desligue também as referências (alfinetes com nome) que não servem ali.
   - Para não ter o quadrinho, desligue a chave **Ligado**.
6. Clique em **Baixar DXF** e cole o desenho no quadro do mapa de situação da prancha (124,6 × 113 por padrão).

## Para quem mexe no código

- `npm install`: instala as dependências
- `npm run dev`: abre o site em modo de desenvolvimento
- `npm test`: roda os testes
- `npm run build`: confere os tipos e gera o site em `dist`
- `npm run base:baixar` e `npm run base:gerar`: refazem a base do Ceará em `public/base`
- `npm run base:baixar-terra` e `npm run base:gerar-terra`: refazem a base de estradinhas de terra em `public/base/estradinhas` (a geração pede bastante memória e leva um tempo)

## Créditos

Dados de estradas © colaboradores do OpenStreetMap (ODbL). Nomes de municípios: IBGE.
