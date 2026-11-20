---
name: barra
description: Controla a barra «Voz» do Windows (a barra de vidro ao estilo macOS no topo do ecrã, com a ilha dinâmica, as conversas e as autorizações do Claude). Usa quando o utilizador pede, em palavras suas, para instalar, abrir, fechar ou desinstalar a barra, mudá-la de posição ou de monitor, mudar o tema, o vidro (líquido, fosco, clássico, mais ou menos transparente, refração, brilho…), ligar ou desligar módulos (relógio do pedido, contexto e tokens, microfone, conversas…), os avisos, as autorizações e perguntas na barra, o não incomodar, a língua ou a moeda dos tokens, ou quando abre com o Windows.
when_to_use: Exemplos — «põe a barra em baixo», «a barra no outro ecrã», «tira o relógio da barra», «quero o vidro mais transparente», «muda para vidro fosco», «barra em modo escuro», «não quero avisos na barra», «a barra não arranque com o Windows», «instala a barra», «esconde a barra».
argument-hint: "[instalar|ligar|desligar|posicao <…>|arranque <windows|claude|mao>|ajustes|ajustar <chave=valor…>|modulo <id> on|off|desinstalar] ou um pedido em palavras tuas"
allowed-tools: Bash(node:*)
---
# Barra «Voz»

Tudo se faz com um só programa (corre-o com a ferramenta Bash; a instalação descarrega e compila, por isso usa um timeout de 300000 ms nela):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" barra <subcomando>
```

## Se vieram argumentos

Argumentos recebidos: `$ARGUMENTS`

Se o texto acima for um subcomando (instalar, ligar, desligar, posicao, arranque, ajustes, ajustar, modulos, modulo, desinstalar), corre-o tal como está e responde em português de Portugal, numa ou duas frases, com o que o programa escreveu. Se for um pedido em palavras normais, ou se estiver vazio e o pedido vier da conversa, segue a secção seguinte.

## Pedido em palavras normais

1. Corre primeiro `barra ajustes`: mostra cada ajuste com o valor atual, os valores possíveis e o que é, os módulos ligados e se a barra está instalada. Decide sempre a partir dos valores atuais, nunca de memória.
2. Traduz o pedido para um (ou vários) dos subcomandos abaixo e corre-os. Junta várias mudanças num só `ajustar` (`barra ajustar barraTema=escuro barraMaterial=fosco`).
   O que `ajustes` já mostra como pedido (um módulo já desligado, a posição já em baixo) não se volta a mudar: diz só que já estava assim.
3. Responde numa ou duas frases a dizer o que mudou (a barra atualiza-se sozinha, não é preciso reiniciá-la). Se o programa disser «Nada mudou», explica porquê e o que é possível.
   Se `ajustes` disser `Barra NÃO instalada`, as mudanças ficam guardadas e aplicam-se quando a barra for instalada: diz isso e oferece `/voz:barra instalar`.

| O utilizador quer… | Subcomando |
| :- | :- |
| instalar / abrir / fechar / remover a barra | `instalar` · `ligar` · `desligar` · `desinstalar` |
| mudar o sítio («em baixo», «à esquerda», «a flutuar», «esconde-a») | `ajustar barraPosicao=topo\|fundo\|esquerda\|direita\|flutuante\|escondida` |
| noutro monitor | `ajustar barraEcra=N` (-1 = principal; 0, 1, 2… pela ordem do Windows) |
| quando abre (com o Windows, com o Claude, só à mão) | `arranque windows\|claude\|mao` |
| claro / escuro / seguir o Windows | `ajustar barraTema=claro\|escuro\|sistema` |
| tipo de vidro | `ajustar barraMaterial=liquido\|fosco\|personalizado\|classico` (`classico` = sem vidro líquido, o aspeto antigo; `personalizado` = vidro líquido com os valores afinados). Se pedir «vidro líquido» e o material já for `personalizado`, já é vidro líquido: não mudes, senão perdem-se as afinações. |
| afinar o vidro («mais transparente», «mais refração», «menos brilho») | `ajustar vidroTransparencia=…` etc. «Um pouco» = 10 pontos (ou 2–4 px); «muito» = 20–25 pontos, a partir do valor atual e dentro dos limites que `ajustes` mostra. Mais `vidroTransparencia` = mais transparente. O material passa sozinho a «personalizado». |
| repor o vidro de origem («como vinha», «de fábrica») | `ajustar barraMaterial=liquido` |
| avisos quando uma conversa termina | `ajustar barraAvisos=sim\|nao` |
| responder às conversas pela barra | `ajustar respostasPelaBarra=sim\|nao` |
| autorizações e perguntas do Claude na barra | `ajustar aprovarPelaBarra=sim\|nao` |
| não incomodar | `ajustar naoIncomodar=sim\|nao` (para horários usa o comando `/voz:silencio`) |
| língua da barra e da voz | `ajustar idioma=auto\|pt\|en\|es` |
| moeda do custo dos tokens | `ajustar moeda=auto\|eur\|usd` |
| mostrar ou tirar um elemento da barra | `modulo <id> on\|off` |

Módulos (`id` → o que é na barra):
- `ilha` — ilha dinâmica ao centro (o que o Claude está a fazer, autorizações, ditado)
- `sessao` — nome da conversa ativa · `conversas` — as conversas ativas · `sessoes` — pontos das sessões (antigo)
- `acao` — o que está a fazer · `legenda` — legenda do que a voz diz · `onda` — onda da voz (a ilha já mostra isto)
- `contexto` — contexto e tokens · `tempo` — tempo do pedido (a barra não mostra as horas: «o relógio» ou «o tempo» é este módulo)
- `microfone` — botão para falar com o Claude · `silencio` — botão de não incomodar · `tema` — botão claro/escuro · `som` — Centro de Controlo

## Limites

- O vidro líquido só aparece com a barra encaixada (topo, fundo, esquerda ou direita); flutuante ou escondida usa o clássico. Se pedir as duas coisas («a flutuar com vidro»), aplica a posição, deixa o material como está e explica que o vidro volta quando a barra for encaixada.
- Se pedir algo que a barra não tem (uma cor própria, as horas, um tamanho de letra…), diz que não existe e oferece o mais parecido que exista (tema claro/escuro, tipo de vidro). Não inventes ajustes.
- A barra é só para Windows. Noutro sistema, explica isso e não corras a instalação.
- A ordem dos módulos e as vozes não se mudam aqui: a ordem muda-se arrastando nas definições da própria barra («Módulos visíveis…») e as vozes com `/voz:vozes`.
- Não mexas noutros ficheiros nem na configuração à mão: usa sempre o programa, que valida os valores.
