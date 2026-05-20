# Banco interno de modelos/flyers

Esta pasta guarda modelos visuais reutilizaveis do IA4Tube Empresas. A estrutura nova separa modelos ativos, candidatos, experimentais e desativados para permitir curadoria sem quebrar pedidos antigos.

## Estrutura recomendada

```txt
banco_modelos/
  index.json
  vidracaria/
    ativos/
      modelo_01/
        metadata.json
        preview.jpg
        thumb.jpg
    candidatos/
    experimentais/
    desativados/
```

`metadata.json` descreve quando o modelo deve ser usado. `preview.jpg` e a referencia visual principal. `thumb.jpg` e uma miniatura para futuras telas internas.

## Campos principais do metadata.json

- `id`: identificador interno do modelo.
- `versao`: versao do modelo/metadata.
- `ativo`: se pode entrar no indice e ser usado em pedidos.
- `nicho`: nome legivel do nicho.
- `nicho_slug`: nome normalizado do nicho.
- `subtipo`: recorte comercial dentro do nicho.
- `objetivo`: objetivo comercial mais comum para o modelo.
- `tipo_post`: promocional, institucional, servico, oferta, story etc.
- `formato`: feed, story, reels_cover ou outro formato futuro.
- `estilo`: lista de estilos visuais.
- `paleta`: lista de cores principais.
- `composicao`: estrutura visual do flyer.
- `densidade_texto`: baixa, media ou alta.
- `tipo_fundo`, `iluminacao`, `emocao_visual`, `foco_comercial`: direcao criativa e comercial.
- `qualidade_visual`: classificacao de curadoria.
- `score`, `usos`, `aprovacoes`, `rejeicoes`: base para ranking futuro.
- `origem`, `criado_por`, `criado_em`, `atualizado_em`: auditoria.
- `tags`: palavras-chave para busca.
- `texto_principal`: exemplo de texto central.
- `cta`: chamada de acao.
- `elementos`: elementos visuais esperados.
- `imagem_exemplo`: nome do arquivo de imagem do modelo.
- `thumb`: nome da miniatura.

## Como adicionar um modelo premium manualmente

1. Crie uma pasta em `banco_modelos/<nicho_slug>/ativos/<modelo_id>/`.
2. Salve a arte curada como `preview.jpg`.
3. Salve uma miniatura como `thumb.jpg`.
4. Crie `metadata.json` usando os campos acima.
5. Defina `ativo: true` somente se o modelo estiver aprovado para uso.
6. Rode o indexador para atualizar `banco_modelos/index.json`.

Modelos em `candidatos/`, `experimentais/` e `desativados/` nao entram no indice enquanto nao forem movidos para `ativos/` e marcados como `ativo: true`.
