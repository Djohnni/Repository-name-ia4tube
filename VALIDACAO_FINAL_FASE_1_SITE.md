# VALIDAÇÃO FINAL DA FASE 1 - SITE IA4TUBE

Data: 2026-07-12  
Escopo validado: nova landing local do `index.html` criada na Fase 1.  
Arquivos de produto alterados na Fase 1: somente `index.html`.  
Restrições respeitadas: nenhum arquivo Android alterado, nenhum build Android, nenhum AAB, nenhum commit, nenhum push, nenhum deploy.

---

## 1. Resultado visual

Foram geradas capturas completas da landing, do topo ao rodapé.

### Desktop

Arquivo:

`C:\Users\SEJA BEM VINDO(A)\Desktop\ia4tube_oficial\IA4tube\VALIDACAO_FASE_1_DESKTOP_FULLPAGE.png`

Resumo da captura:

- Viewport usado: `1280x4080`.
- A landing aparece do topo ao rodapé.
- A primeira tela comunica iA4Tube, proposta, CTA e exemplo visual.
- Seções visíveis na captura:
  - hero;
  - como funciona;
  - exemplo visual;
  - preços;
  - aplicativo;
  - FAQ/confiança;
  - CTA final;
  - rodapé.

### Celular

Arquivo:

`C:\Users\SEJA BEM VINDO(A)\Desktop\ia4tube_oficial\IA4tube\VALIDACAO_FASE_1_CELULAR_FULLPAGE.png`

Resumo da captura:

- Viewport usado: `390x7115`.
- A landing aparece do topo ao rodapé.
- Conteúdo empilha corretamente.
- CTAs estão grandes e clicáveis.
- Não há sobreposição visível na captura de 390 px.

Observação técnica:

Também foram geradas capturas auxiliares durante a validação com o navegador interno, mas as capturas finais corretas são as duas com sufixo `FULLPAGE`.

---

## 2. Problemas encontrados

### P0 - Parâmetros dos CTAs não são interpretados pelo `app.html`

O CTA principal aponta para:

`app.html?origem=site-home&acao=primeira-arte`

Porém, no código atual de `app.html`, não há leitura de:

- `URLSearchParams`;
- `location.search`;
- `searchParams`;
- `origem`;
- `acao`;
- `primeira-arte`.

Resultado:

O link abre `app.html`, mas **não executa um comportamento especial de primeira arte grátis**.

Impacto:

- O visitante vindo da landing não é levado exatamente ao fluxo prometido.
- A landing promete uma ação mais direcionada do que o app atualmente executa.
- Isso pode reduzir conversão, porque o usuário precisa se orientar sozinho dentro do app web.

Status:

**Necessita correção antes de considerar a Fase 1 aprovada para tráfego pago.**

### P0 - O texto obrigatório está sem acento em “grátis”

Texto exigido:

`Criar minha primeira arte grátis`

Texto atual encontrado:

`Criar minha primeira arte gratis`

Também foram encontrados outros textos sem acento:

- `Criar gratis`;
- `Primeira arte gratis para empresas`;
- `Comece gratis`;
- `Criar minha arte gratis`;
- `Precos`;
- `Duvidas`;
- `voce`;
- `negocio`;
- `tres`;
- `informacoes`;
- `facil`;
- `mes`.

Impacto:

- Reduz polimento e confiança.
- Contraria a exigência explícita da validação.
- Pode prejudicar percepção profissional.

Status:

**Necessita correção textual.**

### P1 - Combos não estão apresentados com nomes, quantidades e preços completos

Backend e app usam:

| Plano | Preço | Quantidade |
|---|---:|---:|
| i4 Essencial | R$ 39,90/mês | 8 artes/mês |
| i4 Profissional | R$ 79,90/mês | 20 artes/mês |
| i4 Empresarial | R$ 149,90/mês | 40 artes/mês |

A landing atual mostra apenas:

- `Combos mensais`;
- `R$ 39,90 /mes`;
- texto genérico sobre artes mensais e recursos extras.

Não há preço errado, mas há informação incompleta. O valor `R$ 39,90` deveria ser apresentado como plano `i4 Essencial` ou como "a partir de R$ 39,90/mês".

Impacto:

- Pode gerar dúvida comercial.
- Não comunica a força dos combos.
- Não mostra 8/20/40 artes, que é parte central do valor.

Status:

**Necessita ajuste de clareza comercial.**

### P1 - Homepage não tem botão “Entrar” visível no cabeçalho

A landing possui caminhos de entrada:

- `Entrar pelo site`, na seção do aplicativo;
- `Entrar`, no rodapé.

Mas o cabeçalho, principalmente no topo da página, não tem um botão `Entrar`.

Impacto:

- Cliente existente pode procurar acesso à conta.
- No mobile, o menu reduzido mostra apenas `Criar grátis`, não `Entrar`.
- O acesso existe, mas não está suficientemente visível.

Status:

**Necessita ajuste de navegação para clientes existentes.**

### P1 - Pequeno overflow horizontal em 320 px

Resultado do teste em `320x720`:

- `horizontalOverflow: true`;
- `scrollWidth: 325`;
- overflow aproximado: 5 px.

Em `390`, `768`, `1280` e `1920` não houve overflow.

Impacto:

- Pequeno, mas deve ser corrigido para celulares muito estreitos.

Status:

**Necessita correção responsiva pequena.**

### P2 - Imagem de exemplo contém dados fictícios/telefone de demonstração

A imagem usada mostra uma arte médica com telefone e marca de exemplo.

Impacto:

- Como prova visual, funciona.
- Como material comercial público, pode parecer exemplo real com dados específicos.
- Idealmente deve haver galeria curada com exemplos autorizados ou claramente fictícios.

Status:

**Aceitável para validação local, mas deve ser curado antes de campanha paga.**

---

## 3. CTAs testados

### Resumo

Foram encontrados 18 links/botões principais na landing.

| # | Texto exibido | Destino | Parâmetros | Comportamento esperado | Comportamento real | Deslogado | Celular | Veredito |
|---:|---|---|---|---|---|---|---|---|
| 1 | `iA4 / iA4Tube` | `#top` | nenhum | Voltar ao topo | Funciona como âncora | Sim | Sim | OK |
| 2 | `Como funciona` | `#como-funciona` | nenhum | Rolar até explicação | Funciona como âncora | Sim | Oculto no menu mobile | OK |
| 3 | `Exemplos` | `#exemplos` | nenhum | Rolar até exemplos | Funciona como âncora | Sim | Oculto no menu mobile | OK |
| 4 | `Precos` | `#precos` | nenhum | Rolar até preços | Funciona, mas texto sem acento | Sim | Oculto no menu mobile | Corrigir texto |
| 5 | `Aplicativo` | `#app` | nenhum | Rolar até app | Funciona como âncora | Sim | Oculto no menu mobile | OK |
| 6 | `Criar gratis` | `app.html` | `origem=site-home&acao=primeira-arte` | Abrir fluxo de primeira arte grátis | Abre app padrão; parâmetros ignorados | Parcial | Sim | Corrigir comportamento/texto |
| 7 | `Criar minha primeira arte gratis` | `app.html` | `origem=site-home&acao=primeira-arte` | Abrir fluxo de primeira arte grátis | Abre app padrão; parâmetros ignorados | Parcial | Sim | Corrigir comportamento/texto |
| 8 | `Ver como funciona` | `#como-funciona` | nenhum | Rolar até explicação | Funciona | Sim | Sim | OK |
| 9 | `Criar primeira arte` | `app.html` | `origem=site-precos&acao=primeira-arte` | Abrir fluxo de primeira arte | Abre app padrão; parâmetros ignorados | Parcial | Sim | Corrigir comportamento |
| 10 | `Criar arte avulsa` | `app.html` | `origem=site-precos&acao=arte-avulsa` | Abrir fluxo de arte avulsa/compra | Abre app padrão; parâmetros ignorados | Parcial | Sim | Corrigir comportamento |
| 11 | `Ver combos` | `app.html` | `origem=site-precos&acao=combos` | Abrir combos | Abre app padrão; parâmetros ignorados | Parcial | Sim | Corrigir comportamento |
| 12 | `Baixar na Google Play` | Google Play | `id=com.ia4tube.app` | Abrir loja em nova aba | Correto, `target="_blank"` e `rel="noopener"` | Sim | Sim | OK |
| 13 | `Entrar pelo site` | `app.html` | `origem=site-app&acao=entrar` | Abrir login | Abre app padrão; usuário ainda precisa clicar em Entrar | Parcial | Sim | Corrigir comportamento ou copy |
| 14 | `Criar minha arte gratis` | `app.html` | `origem=site-final&acao=primeira-arte` | Abrir fluxo de primeira arte | Abre app padrão; parâmetros ignorados | Parcial | Sim | Corrigir comportamento/texto |
| 15 | `Ver aplicativo` | Google Play | `id=com.ia4tube.app` | Abrir loja em nova aba | Correto, `target="_blank"` e `rel="noopener"` | Sim | Sim | OK |
| 16 | `Entrar` | `app.html` | `origem=site-footer&acao=entrar` | Abrir login | Abre app padrão; usuário ainda precisa clicar em Entrar | Parcial | Sim | Corrigir ou aceitar |
| 17 | `Google Play` | Google Play | `id=com.ia4tube.app` | Abrir loja em nova aba | Correto, `target="_blank"` e `rel="noopener"` | Sim | Sim | OK |
| 18 | `Duvidas` | `#confianca` | nenhum | Rolar até FAQ | Funciona, mas texto sem acento | Sim | Sim | Corrigir texto |

### Teste especial do CTA principal

CTA:

`app.html?origem=site-home&acao=primeira-arte`

Resultado no `app.html`:

- URL preserva a query string.
- `app.html` não lê nem interpreta a query string.
- O estado renderizado foi equivalente ao `app.html` sem parâmetros.
- O body ficou com classe `ia4-empresas visitanteNaoLogado` no teste deslogado.
- Botões visíveis no topo do app web: `Entrar`, `Cadastro`, `WhatsApp Falar direto`.
- Não houve abertura automática do fluxo de primeira arte grátis.

Conclusão:

**O link abre o app web, mas ainda não leva exatamente ao fluxo correto.**

---

## 4. Fluxo para usuários novos

### Usuário sem conta clica no CTA principal

Comportamento esperado:

1. Abrir `app.html`.
2. Reconhecer `acao=primeira-arte`.
3. Destacar/abrir o fluxo de primeira arte grátis.
4. Manter o visitante orientado.

Comportamento real:

1. Abre `app.html`.
2. A query string fica na URL.
3. O app web não interpreta `origem`/`acao`.
4. Usuário vê a experiência padrão do app web deslogado.

Veredito:

**Parcial. Abre o app, mas não executa o fluxo planejado.**

### Usuário deslogado entra direto em `app.html`

Comportamento observado:

- `app.html` carrega em estado visitante.
- Mostra botões `Entrar` e `Cadastro`.
- Fluxo padrão continua disponível, mas não é roteado pela landing.

Veredito:

**Funciona como entrada geral, mas não como destino especializado da landing.**

### Usuário novo quer testar grátis

Problema:

A landing promete primeira arte grátis, mas depende do usuário se orientar dentro do app web. Isso é fricção.

Correção recomendada:

Implementar no site/app web, sem Android:

- leitura de `new URLSearchParams(location.search)`;
- se `acao=primeira-arte`, ativar `arte_empresa`;
- rolar até o bloco correto;
- exibir mensagem contextual de primeira arte grátis;
- manter comportamento padrão quando não houver parâmetro.

---

## 5. Fluxo para usuários existentes

### Usuário já logado clica no CTA

Não foi feito login real nesta validação. Pelo código atual:

- `app.html` verifica token local;
- se houver token, carrega estado logado;
- os parâmetros `origem` e `acao` continuam ignorados.

Conclusão:

Usuário logado deve entrar no app web normalmente, mas não será roteado por intenção.

### Usuário volta para a homepage

Comportamento:

- Landing é pública e estática.
- Não há saudação de usuário logado.
- Não há estado personalizado.

Isso é aceitável para homepage pública.

### Usuário acessa diretamente a página de login

Estado atual:

- A antiga tela de login da raiz foi substituída.
- O login real está dentro de `app.html`, acionado pelo botão `Entrar`.
- A homepage possui `Entrar pelo site` na seção do app e `Entrar` no rodapé.

Problema:

O topo da homepage não possui botão `Entrar` visível. Cliente existente pode demorar para achar.

Correção recomendada:

Adicionar `Entrar` no cabeçalho, ao lado de `Criar minha primeira arte grátis`, apontando para uma entrada de login. Como `acao=entrar` ainda não é interpretado, a opção segura é:

`app.html`

ou implementar primeiro a interpretação de:

`app.html?acao=entrar`

---

## 6. Divergências de preços ou textos

### Arte avulsa

Landing:

- `R$ 5,99`.

Backend:

- `SINGLE_ART_PURCHASE.amount = 5.99`.

App Android:

- `1 arte por R$ 5,99`.

Veredito:

**Preço correto.**

### Combo Essencial

Landing:

- `Combos mensais`;
- `R$ 39,90 /mes`;
- não informa `i4 Essencial`;
- não informa `8 artes/mês`.

Backend:

- `i4 Essencial`;
- `R$ 39,90`;
- `8 artes/mês`;
- 3 materiais gráficos gerais;
- 1 carrossel.

App Android:

- `i4 Essencial`;
- `R$ 39,90`;
- `8 artes para postar por mês`.

Veredito:

**Preço base correto, mas texto incompleto e sem acento.**

### Combo Profissional

Landing:

- Não aparece.

Backend/app:

- `i4 Profissional`;
- `R$ 79,90`;
- `20 artes/mês`;
- 5 materiais gráficos gerais;
- 1 material gráfico de nicho;
- 2 carrosséis.

Veredito:

**Ausente na landing.**

### Combo Empresarial

Landing:

- Não aparece.

Backend/app:

- `i4 Empresarial`;
- `R$ 149,90`;
- `40 artes/mês`;
- todos os materiais gráficos gerais;
- 3 materiais gráficos de nicho;
- 4 carrosséis.

Veredito:

**Ausente na landing.**

### Primeira arte grátis

Landing:

- Promete primeira arte grátis.
- Texto está sem acento em alguns pontos.

Backend/app:

- Existem fluxos e referências a `arte_gratis`/primeira arte grátis no `app.html` e backend.

Veredito:

**Oferta coerente, mas CTA ainda não ativa o fluxo por parâmetro.**

### Textos que precisam de correção

Correções textuais recomendadas:

| Atual | Recomendado |
|---|---|
| `Criar gratis` | `Criar grátis` |
| `Criar minha primeira arte gratis` | `Criar minha primeira arte grátis` |
| `Primeira arte gratis para empresas` | `Primeira arte grátis para empresas` |
| `Precos` | `Preços` |
| `Duvidas` | `Dúvidas` |
| `Da ideia ao post em tres passos` | `Da ideia ao post em três passos` |
| `voce` | `você` |
| `negocio` | `negócio` |
| `informacoes` | `informações` |
| `referencia` | `referência` |
| `facil` | `fácil` |
| `/mes` | `/mês` |

---

## 7. Responsividade

Viewports testados:

| Viewport | Resultado |
|---|---|
| `320x720` | Pequeno overflow horizontal de cerca de 5 px. |
| `390x844` | Sem overflow, sem console errors. |
| `768x900` | Sem overflow, sem console errors. |
| `1280x720` | Sem overflow, sem console errors. |
| `1920x1080` | Sem overflow, sem console errors. |

### 320 px

Problema:

- `scrollWidth = 325`.
- Botões principais continuam clicáveis.
- O overflow parece vir da soma de container + largura de elementos no hero.

Impacto:

- Pequeno, mas real.

Correção recomendada:

- Ajustar largura máxima do hero/containers em mobile estreito.
- Garantir `width: 100%` e `max-width: 100%` nos blocos internos.
- Reduzir padding lateral em `max-width: 360px`, se necessário.

### 390 px

Resultado:

- Sem overflow.
- Botões com 48 px ou mais de altura.
- Conteúdo empilhado corretamente.
- Menu mobile mostra apenas marca e CTA principal; os links de navegação são ocultados.

### 768 px

Resultado:

- Sem overflow.
- Layout empilhado como tablet.
- Menu ainda reduzido, mostrando apenas CTA principal.

### 1280 px e 1920 px

Resultado:

- Sem overflow.
- Hero e seções aparecem bem distribuídos.
- Próxima seção fica visível logo após a primeira dobra.

---

## 8. Acessibilidade

### Pontos positivos

- Há apenas um `h1`.
- A hierarquia `h1 > h2 > h3` está coerente.
- Imagens possuem `alt`.
- Botões/links principais têm área clicável adequada.
- Links externos da Google Play usam `target="_blank"` e `rel="noopener"`.
- A página tem `lang="pt-br"`.
- Existe `main`.
- Existe `nav` com `aria-label`.

### Pontos de atenção

1. **Foco visível**
   - Não há estilo customizado de `:focus-visible`.
   - O navegador deve aplicar foco padrão, mas a landing ficaria mais profissional com foco explícito.

2. **Menu mobile**
   - Em telas abaixo de 900 px, links como `Como funciona`, `Exemplos`, `Preços` e `Aplicativo` somem.
   - Isso é aceitável para simplicidade, mas reduz navegação rápida.
   - O problema maior é que `Entrar` também não aparece no topo.

3. **Fonte mínima**
   - Fonte mínima medida: `12px`.
   - Alguns textos auxiliares e rodapé podem ficar pequenos em mobile.

4. **Contraste**
   - Botões principais verdes com texto branco parecem adequados.
   - Textos secundários em cinza sobre fundo claro parecem legíveis, mas recomenda-se validação WCAG formal antes de tráfego pago.

---

## 9. Performance

### Tamanho dos recursos

| Recurso | Tamanho |
|---|---:|
| `index.html` | 20.245 bytes |
| CSS inline dentro do HTML | 9.293 bytes |
| `todas imagens/resultado_final.raw.jpeg` | 216.396 bytes |
| `todas imagens/resultado_final.png` | 1.354.862 bytes, não usado pela landing |

### Recursos carregados pela landing

O HTML atual referencia:

- `todas imagens/resultado_final.raw.jpeg` duas vezes;
- nenhum script;
- nenhum vídeo;
- nenhuma fonte externa;
- nenhum CSS externo;
- nenhum recurso de terceiros no carregamento inicial.

### Impacto esperado

Pontos positivos:

- Página leve em HTML.
- Sem JavaScript na landing.
- Sem vídeos.
- Sem fontes externas bloqueantes.
- Hero usa JPEG de aproximadamente 216 KB.

Pontos de atenção:

1. A mesma imagem aparece duas vezes no HTML.
   - O navegador deve usar cache, mas ainda é o mesmo asset visual repetido.

2. A imagem é `1024x1536`, maior do que o tamanho em que aparece.
   - Para Core Web Vitals, seria melhor gerar versões otimizadas:
     - mobile;
     - desktop;
     - thumbnail para seção de exemplo.

3. O CSS é inline.
   - Para uma landing pequena isso é aceitável.
   - Se a página crescer, pode ser melhor separar CSS ou minificar.

4. LCP provável:
   - O maior elemento acima da dobra deve ser o H1 ou imagem hero.
   - A imagem de 216 KB é aceitável, mas pode melhorar com `srcset`.

Veredito performance:

**Boa para Fase 1, com oportunidade de otimização de imagem antes de tráfego maior.**

---

## 10. Google Play

Links encontrados na landing:

`https://play.google.com/store/apps/details?id=com.ia4tube.app`

Quantidade:

- 3 links.

Comportamento:

- Todos usam `target="_blank"`.
- Todos usam `rel="noopener"`.
- Funcionam em desktop e celular como links externos.

Confirmação pública:

- Página na Google Play encontrada para o app `ia4tube`.
- Pacote: `com.ia4tube.app`.
- Desenvolvedor exibido: `Djohnni`.
- A página pública informa atualização em `8 de jul. de 2026`.

Problema externo observado:

- A seção "O que há de novo" da Play Store ainda exibe texto de placeholder.
- Isso não é problema da landing, mas afeta confiança quando o usuário clica na loja.

Veredito:

**URL da landing está correta.**

---

## 11. Git e Android

### Arquivos alterados nesta fase de implementação

Produto/site:

- `index.html`

### Artefatos gerados nesta validação

Capturas finais:

- `VALIDACAO_FASE_1_DESKTOP_FULLPAGE.png`
- `VALIDACAO_FASE_1_CELULAR_FULLPAGE.png`

Relatório:

- `VALIDACAO_FINAL_FASE_1_SITE.md`

Também existem capturas auxiliares geradas durante o processo de validação:

- `VALIDACAO_FASE_1_DESKTOP_1280x720.png`
- `VALIDACAO_FASE_1_CELULAR_390x844.png`
- `VALIDACAO_FASE_1_DESKTOP_1280x720_COMPLETA.png`
- `VALIDACAO_FASE_1_CELULAR_390x844_COMPLETA.png`

### Estado Android

O `git status` mostra alterações antigas/preexistentes em `app_mobile/android`, incluindo:

- `app_mobile/android/app/build.gradle.kts`;
- `app_mobile/android/app/src/main/AndroidManifest.xml`;
- arquivos de analytics;
- API client;
- models;
- repositories;
- viewmodels;
- telas de create art, home, monthly planning e plans;
- diretórios de build e release não rastreados.

Essas alterações **não foram feitas nesta fase**.

Nesta Fase 1:

- não alterei arquivos em `app_mobile/android`;
- não executei build Android;
- não gerei AAB;
- não alterei `versionCode`;
- não alterei `versionName`;
- não publiquei na Google Play.

---

## 12. Plano de correção recomendado

Não implementei as correções abaixo nesta validação. Elas devem aguardar autorização.

### Correção 1 - Textos e acentuação

Escopo:

- Corrigir `grátis`, `você`, `três`, `negócio`, `informações`, `preços`, `dúvidas`, `mês`, etc.

Risco:

- Baixo.

Impacto:

- Médio/alto em confiança.

### Correção 2 - CTA principal realmente abrir primeira arte

Escopo:

- Em `app.html`, ler `URLSearchParams(location.search)`.
- Se `acao=primeira-arte`, ativar `arte_empresa` e rolar para o bloco correto.
- Se `acao=entrar`, abrir modal de login.
- Se `acao=combos`, abrir/rolar para área de compra compatível, se existir.

Risco:

- Médio, porque toca o web app.

Compatibilidade:

- Pode ser feito sem Android.
- Deve ser aditivo e retrocompatível.

### Correção 3 - Botão Entrar no cabeçalho da landing

Escopo:

- Adicionar `Entrar` visível no topo.
- No mobile, manter pelo menos `Entrar` e `Criar grátis`.

Risco:

- Baixo.

Impacto:

- Alto para clientes existentes.

### Correção 4 - Combos completos

Escopo:

- Trocar o card genérico por:
  - i4 Essencial - R$ 39,90/mês - 8 artes/mês;
  - i4 Profissional - R$ 79,90/mês - 20 artes/mês;
  - i4 Empresarial - R$ 149,90/mês - 40 artes/mês.

Risco:

- Baixo/médio.

Impacto:

- Alto em clareza comercial.

### Correção 5 - Overflow em 320 px

Escopo:

- Ajuste CSS mobile estreito.

Risco:

- Baixo.

Impacto:

- Baixo/médio.

### Correção 6 - Otimizar imagem de exemplo

Escopo:

- Criar imagem menor para hero.
- Usar `srcset`.
- Curar exemplos sem dados confusos.

Risco:

- Baixo.

Impacto:

- Médio em performance e confiança.

---

## 13. Veredito

**Necessita correções antes de aprovar a Fase 1 para tráfego pago.**

A landing representa um avanço grande em relação à homepage antiga, porque:

- remove a tela antiga de login/O Mascote;
- comunica iA4Tube;
- mostra proposta clara;
- apresenta primeira arte grátis;
- mostra preço de arte avulsa correto;
- aponta para Google Play;
- funciona bem em 390, 768, 1280 e 1920 px;
- não tem scripts, vídeos ou fontes externas.

Mas ainda não considero a Fase 1 totalmente aprovada porque há problemas que afetam conversão:

1. O CTA principal não executa o fluxo planejado de primeira arte grátis.
2. Os parâmetros `origem` e `acao` ainda são ignorados por `app.html`.
3. O texto exigido `Criar minha primeira arte grátis` está sem acento.
4. Cliente existente não tem `Entrar` visível no cabeçalho.
5. Combos estão incompletos em relação ao backend/app.
6. Há pequeno overflow em 320 px.

Recomendação:

**Antes da Fase 2, autorizar uma rodada curta de correções da Fase 1.**

Essa rodada deve corrigir primeiro:

1. acentuação/textos;
2. botão `Entrar` no topo;
3. interpretação de `acao=primeira-arte` no `app.html`;
4. combos completos;
5. overflow em 320 px.

Depois disso, a Fase 1 deve ser revalidada e só então seguir para a Fase 2.

