# Filtro Cromático – diagnóstico e filtros de cor

Projeto web em HTML, CSS e JavaScript puro para auxiliar pessoas com deficiência de visão de cores.
Sem dependências e sem build: abra o `index.html` direto no navegador (file://).

## Estrutura
- `index.html`: página única em grid com os blocos Importar, Diagnóstico, Perfil, Laboratório e Exportar. Sem links de navegação: o topo tem só o título e os botões Importar e Exportar. O Diagnóstico tem o acordeão "Como usar" (`<details>` nativo).
- `styles/main.css`: grid responsivo com `grid-template-areas`. ≥1180px: 3 colunas (esquerda Importar + Diagnóstico, centro Laboratório, direita Perfil + Exportar). ≥760px: 2 colunas, Laboratório na largura toda. Abaixo: 1 coluna na ordem Importar, Diagnóstico, Perfil, Laboratório, Exportar. Tema escuro com contraste AA e foco visível.
- `js/color-matrix.js`: motor de matriz 3x3 (daltonização M = I + E(I − S), Machado et al. 2009), aplicação em ImageData e perfil no localStorage.
- `js/diagnostic.js`: teste de ordenação de matizes estilo Farnsworth D-15 (1 peça fixa + 15 móveis), arrastar com mouse/toque ou teclado/botões, pontuação de Vingrys & King-Smith (1988): ângulo de confusão, C-index, S-index, TES.
- `js/lab.js`: upload de imagem e vídeo, imagem de demonstração, renderização frame a frame e slider split-screen.
- `js/export.js`: snippet CSS/SVG (feColorMatrix), LUT `.cube`, perfil `.json` e bookmarklet.
- `js/import.js`: importação de perfil `.json` e de LUT `.cube` (funções puras, testáveis no Node).
- `js/app.js`: orquestração.
- `tests/diagnostic.test.js`: testes da pontuação (`node tests/diagnostic.test.js`).
- `tests/import.test.js`: testes da importação (`node tests/import.test.js`).

## Classificação do diagnóstico
- C-index < 1,6 → sem indicação (grau 0%, sem correção).
- Ângulo > +0,7° e ≤ 45° → protan; entre −45° e +0,7° → deutan; |ângulo| > 45° → tritan.
- Grau: C-index 1,6 → 20%, C-index ≥ 3,6 → 100%.

É uma triagem e não substitui avaliação oftalmológica. As cores das peças dependem da calibração da tela.

## Exportar e importar
Exportar (bloco 5):
- **CSS/SVG**: `<feColorMatrix>` 4x5 + regra CSS.
- **LUT .cube**: 3D LUT 33³ (R varia mais rápido, valores limitados a 0..1), para OBS, players e editores.
- **Baixar perfil .json**: `{ app: "filtro-cromatico", version: 1, type, severity, intensity, matrix[9], adjust: { contrast, brightness }, createdAt, exportedAt }`.
- **Gerar bookmarklet**: o link arrastável só aparece depois de gerado (não fica fixo na página).

Importar (bloco 1, ou botão Importar do topo, que abre o seletor de arquivo):
- Escolher arquivo (`.json`, `.cube`, `.txt`, até 5 MB), arrastar o arquivo para o bloco, ou colar o JSON em "Colar JSON do perfil" e clicar em Importar.
- **JSON**: valida `version` (1), `type` (protanopia, deuteranopia, tritanopia ou custom), `matrix` com 9 números entre −5 e 5. Grau e intensidade fora de 0..1, contraste fora de 0,5..1,5 e brilho fora de −0,5..0,5 são ajustados com aviso. Também aceita o perfil cru do localStorage e `{ "profile": {...} }`.
- **.cube**: lê `TITLE`, `LUT_3D_SIZE`, `DOMAIN_MIN/MAX` (ou `LUT_3D_INPUT_RANGE`) e confere se há N³ linhas. A LUT vira uma transformação afim `saída = A·rgb + b` por mínimos quadrados (equações normais 4x4 por canal, sem as amostras saturadas em 0 ou 1). O perfil fica com `matrix = A`, intensidade 1, contraste 1 e brilho = média de `b`, então reexportar reproduz a LUT. O tipo vem do `TITLE` quando ele cita o tipo; senão, `custom`. Se o erro RMS passar de 0,02 (LUT não linear, curvas, gama), aparece um aviso de que a LUT foi aproximada por uma matriz.
- O perfil importado ganha `source: "imported"` e o selo "Perfil importado". A matriz importada é mantida ao mexer em intensidade, contraste e brilho (e ao recarregar a página). Mexer em tipo ou grau, ou rodar o diagnóstico, volta à matriz gerada pelo modelo. Com tipo `custom`, o controle de grau fica desativado.
- Erros (JSON inválido, estrutura errada, arquivo não suportado, .cube inválido, arquivo maior que 5 MB) aparecem numa mensagem com `aria-live` e não alteram o perfil atual.
