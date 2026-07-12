# Correcoes finais da Fase 1 - Site iA4Tube

Data da validacao: 2026-07-12 18:39:16 -03:00

## 1. Arquivos alterados

- `index.html`
- `app.html`

Nao foram alterados arquivos Android nesta etapa. Nao houve build Android, AAB, commit, push ou publicacao.

Observacao de Git: o repositorio ja possui alteracoes anteriores em `app_mobile/android` e em outros arquivos fora deste escopo. Elas foram apenas observadas no status do Git e nao foram revertidas, modificadas ou usadas nesta etapa.

## 2. Correcoes aplicadas

### 2.1 Acentuacao do CTA e textos

Causa:
- A landing da Fase 1 ainda continha textos visiveis sem acento, incluindo `Criar minha primeira arte gratis`.

Solucao:
- Todas as ocorrencias visiveis foram corrigidas para `Criar minha primeira arte grátis`.
- Tambem foram revisados textos de apoio com acentuacao e consistencia de marca `iA4Tube`.

Evidencias:
- `index.html:737`, `index.html:848`, `index.html:953`
- Busca por `gratis`/`Gratis`: sem ocorrencias restantes em `index.html`.

### 2.2 Funcionamento real do CTA principal

Causa:
- `app.html?origem=site-home&acao=primeira-arte` abria o app web, mas `app.html` nao interpretava `origem` e `acao`.

Solucao:
- `app.html` agora le parametros seguros da landing:
  - `origem` iniciado por `site-`
  - `acao=primeira-arte`
  - `acao=entrar`
- O CTA da primeira arte reutiliza o fluxo existente de `arte_empresa`.
- Nao foi criado fluxo duplicado.
- A decisao real de primeira arte gratis continua no backend existente, via pedido de `arte_empresa` e `cobranca_origem=arte_gratis`.
- Quando o usuario esta logado, o front consulta `/billing/free-art/status` apenas para orientar a mensagem.
- A intencao fica preservada por `sessionStorage` por ate 30 minutos para continuidade apos login/cadastro.

Funcoes principais:
- `ia4LerParametrosLandingAtual` em `app.html:11488`
- `ia4PrepararFluxoArteEmpresaLanding` em `app.html:11540`
- `ia4AtualizarMensagemPrimeiraArteGratis` em `app.html:11558`
- `ia4AbrirFluxoPrimeiraArteGratisLanding` em `app.html:11599`
- `ia4ExecutarIntencaoLanding` em `app.html:11614`
- `ia4ContinuarIntencaoLandingAposAuth` em `app.html:11635`
- Inicializacao em `app.html:15611`
- Continuidade apos login Google em `app.html:6802`
- Continuidade apos login/cadastro tradicional em `app.html:12281`

### 2.3 Botao Entrar no cabecalho

Causa:
- A landing nao tinha acesso claro para cliente existente entrar na conta sem clicar no CTA de primeira arte.

Solucao:
- Adicionado link `Entrar` no cabecalho da landing.
- Destino: `app.html?origem=site-home&acao=entrar`.
- No app, `acao=entrar` abre o modal real de login quando o usuario esta deslogado.
- Esse fluxo nao dispara a mensagem nem a intencao da primeira arte gratis.

Evidencias:
- Estilos em `index.html:129` e `index.html:646`
- Link em `index.html:722`

### 2.4 Combos completos e corretos

Causa:
- A landing mostrava apenas um card generico de combos mensais.

Solucao:
- A secao de precos agora exibe os combos oficiais:
  - `i4 Essencial` - `R$ 39,90/mês` - `8 artes`
  - `i4 Profissional` - `R$ 79,90/mês` - `20 artes`
  - `i4 Empresarial` - `R$ 149,90/mês` - `40 artes`
- Os dados foram conferidos no backend em `src/billing/plans.js:2-26`.
- O Android tambem possui esses valores, mas nenhum arquivo Android foi alterado.

Evidencias:
- Grid responsivo em `index.html:414`
- Cards em `index.html:863`, `index.html:874`, `index.html:885`

### 2.5 Overflow em 320 px

Causa:
- O grid da hero tinha largura correta, mas o item interno mantinha `min-width:auto`, forçando a coluna para aproximadamente `308.578px`. Como ela comecava em `16px`, terminava em `324.578px`, criando overflow horizontal em viewport de `320px`.

Solucao:
- Adicionado `min-width:0` aos filhos dos grids principais:
  - `.hero-grid > *`
  - `.examples-grid > *`
  - `.app-grid > *`
- A solucao corrige a causa do overflow sem usar `overflow-x:hidden`.

Evidencia:
- `index.html:205`

## 3. Testes realizados

### 3.1 Sintaxe

- `app.html` teve o script principal extraido e validado com `vm.Script`.
- Resultado: `app.html main script syntax ok`.

### 3.2 Responsividade e overflow

Teste executado no navegador interno com servidor local temporario:
- Site: `http://127.0.0.1:4173`
- Mock de API: `http://127.0.0.1:3000`

Resultados:

| Viewport | ScrollWidth | BodyScrollWidth | Overflow horizontal |
|---|---:|---:|---|
| 320 px | 305 | 305 | Nao |
| 390 px | 375 | 375 | Nao |
| 768 px | 753 | 753 | Nao |
| 1280 px | 1265 | 1265 | Nao |
| 1920 px | 1905 | 1905 | Nao |

### 3.3 CTA principal com usuario deslogado

Entrada:
- Clique em `.hero .hero-actions a.btn-primary`
- URL final: `app.html?origem=site-home&acao=primeira-arte`

Resultado:
- `selectedProduct = arte_empresa`
- `flyerTipo = arte_empresa`
- bloco `arte_empresa` ativo
- modal de login nao abre automaticamente
- mensagem exibida: `Você está no fluxo da primeira arte grátis. Preencha os dados da empresa para continuar.`

### 3.4 CTA principal com usuario logado sem usar a primeira arte gratis

Teste com token local e mock de `/billing/free-art/status`.

Resultado:
- `selectedProduct = arte_empresa`
- `flyerTipo = arte_empresa`
- bloco `arte_empresa` ativo
- mensagem exibida: `Primeira arte grátis disponível. Preencha os dados da empresa para continuar.`
- modal de login fechado

### 3.5 Usuario que ja utilizou a primeira arte gratis

Teste com token local e mock de `/billing/free-art/status` retornando `arte_gratis_usada=true`.

Resultado:
- `selectedProduct = arte_empresa`
- `flyerTipo = arte_empresa`
- bloco `arte_empresa` ativo
- mensagem exibida: `Você já utilizou a primeira arte grátis. Você ainda pode criar uma arte avulsa por R$5,99 ou usar um combo.`

### 3.6 Continuidade apos login

Fluxo testado:
- abrir `app.html?origem=site-home&acao=primeira-arte` deslogado
- clicar em `Entrar` dentro do app
- preencher login contra mock local
- concluir login

Resultado apos login:
- `selectedProduct = arte_empresa`
- `flyerTipo = arte_empresa`
- bloco `arte_empresa` ativo
- modal fechado
- botao superior mudou para `Sair`
- mensagem voltou para `Primeira arte grátis disponível. Preencha os dados da empresa para continuar.`

### 3.7 Continuidade apos cadastro

Fluxo testado:
- abrir `app.html?origem=site-home&acao=primeira-arte` deslogado
- clicar em `Cadastro` dentro do app
- preencher cadastro contra mock local
- concluir cadastro

Resultado apos cadastro:
- `selectedProduct = arte_empresa`
- `flyerTipo = arte_empresa`
- bloco `arte_empresa` ativo
- modal fechado
- botao superior mudou para `Sair`
- a overlay existente de desbloqueio de cadastro apareceu, preservando o comportamento atual do app web

### 3.8 Botao Entrar da landing

Entrada:
- Clique no link `.nav-links .nav-login`
- URL final: `app.html?origem=site-home&acao=entrar`

Resultado:
- modal real de login abriu
- `selectedProduct` permaneceu vazio
- nenhuma mensagem de primeira arte gratis foi exibida
- o bloco `arte_empresa` aparece ativo por comportamento padrao ja existente do app deslogado, nao pelo novo parametro `acao=entrar`

### 3.9 Combos e precos exibidos

Valores confirmados na landing:
- `i4 Essencial` - `R$ 39,90/mês` - `8 artes por mês`
- `i4 Profissional` - `R$ 79,90/mês` - `20 artes por mês`
- `i4 Empresarial` - `R$ 149,90/mês` - `40 artes por mês`

Valores conferidos no backend:
- `src/billing/plans.js:2-26`

### 3.10 Links da Google Play

Foram encontrados 3 links:
- `https://play.google.com/store/apps/details?id=com.ia4tube.app`
- todos com `target="_blank"`
- todos com `rel="noopener"`

### 3.11 Console

Resultado nos testes locais pelo navegador interno:
- nenhum erro de console registrado.

### 3.12 Git e Android

Comando de escopo desta etapa:
- `git diff --name-only -- index.html app.html`

Resultado:
- `app.html`
- `index.html`

Tambem foi verificado que o worktree ja tinha alteracoes anteriores em `app_mobile/android`. Elas nao foram alteradas nesta etapa.

## 4. Riscos restantes

- Os testes logado/deslogado foram executados com mock local de API para evitar modificar dados reais. O contrato usado e retrocompativel com o endpoint existente `/billing/free-art/status`.
- Links de `acao=arte-avulsa` e `acao=combos` continuam fora do escopo desta correcao, porque a autorizacao foi limitada aos cinco pontos finais da Fase 1.
- A overlay de desbloqueio apos cadastro foi mantida porque ja fazia parte do comportamento atual do app web.

## 5. Veredito final da Fase 1

Aprovado para a Fase 1 corrigida.

Os cinco pontos autorizados foram corrigidos, testados localmente e documentados. Nao foi iniciada a Fase 2.
