# Autopilot audit - run 20261002T122805Z-prospeccao-redesign

Tudo que pôde ser feito no código foi feito e está em `master` (4 slices, verde em cada wave).
Abaixo o que só você decide/testa.

## Pronto para release (Gate 3 - humano, nunca automático)
- [ ] `/nexo-ship` - 4 slices `feat(leads)` em master desde o último tag (v4.1.0). Bump seria MINOR (v4.2.0). Autopilot não promove: a run parou em master.

## Testar manualmente (visual, não cobrível em unit test)
- [ ] Abrir o app e conferir pixel-perfeição do redesign em `operacional/leads` (Prospecção) e `meus-dados/leads` (Minha prospecção): cabeçalho de coluna (total/%/barra), cor por etapa, drag-over, selo de dias com faixas, modo Lista (chips, tabela, rodapé), card compacto (clique edita, arrasta move), e o filtro de vendedor oculto em Minha prospecção.

## Decisões tomadas sem você (HOW - registradas)
- `NO_PRODUCTS_DASH` usa `-` (traço simples), não o `—` (em dash) do README, para honrar a regra global "nunca usar em dash". Trocável se você preferir o glifo exato do protótipo.
- Persistência em URL de `leadView`/`leadStageFilter` (`?view=&stage=`) NÃO implementada: é opcional no README e exigiria tocar o routing em SalesOpsApp.tsx (fora do escopo). Estado é de componente.
- `avatarInitials('Ana Paula Souza')` → `AS` (primeiro+último token), seguindo a fórmula do README; o exemplo do README dizia `AP` (inconsistente com a própria fórmula).
- O filtro de vendedor usa `Combobox` (não `<select>` de 40px do protótipo), porque `<select>` nativo é banido por lint neste repo.

## Lacunas menores de cobertura de teste (código shipado correto)
- [ ] (ROADMAP) Oráculo não assere a cor suave/borda da coluna nem a cor do drag-over no Quadro (slice 03). A cor por etapa em si é coberta por `board-ui.test.ts`.
