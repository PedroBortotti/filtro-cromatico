# Daltonismo – diagnóstico e filtros de cor

Projeto web em HTML, CSS e JavaScript puro para auxiliar pessoas com deficiência de visão de cores.
Sem dependências e sem build: abra o `index.html` direto no navegador (file://).

## Estrutura
- `index.html`: página única em grid com os cards Diagnóstico, Laboratório, Perfil e Exportar.
- `styles/main.css`: grid responsivo (3 colunas ≥1180px, 2 colunas ≥760px, 1 coluna abaixo), tema escuro com contraste AA e foco visível.
- `js/color-matrix.js`: motor de matriz 3x3 (daltonização M = I + E(I − S), Machado et al. 2009), aplicação em ImageData e perfil no localStorage.
- `js/diagnostic.js`: teste de ordenação de matizes estilo Farnsworth D-15 (1 peça fixa + 15 móveis), arrastar com mouse/toque ou teclado/botões, pontuação de Vingrys & King-Smith (1988): ângulo de confusão, C-index, S-index, TES.
- `js/lab.js`: upload de imagem e vídeo, imagem de demonstração, renderização frame a frame e slider split-screen.
- `js/export.js`: snippet CSS/SVG (feColorMatrix), LUT `.cube` e bookmarklet.
- `js/app.js`: orquestração.
- `tests/diagnostic.test.js`: testes da pontuação (`node tests/diagnostic.test.js`).

## Classificação do diagnóstico
- C-index < 1,6 → sem indicação (grau 0%, sem correção).
- Ângulo > +0,7° e ≤ 45° → protan; entre −45° e +0,7° → deutan; |ângulo| > 45° → tritan.
- Grau: C-index 1,6 → 20%, C-index ≥ 3,6 → 100%.

É uma triagem e não substitui avaliação oftalmológica. As cores das peças dependem da calibração da tela.
