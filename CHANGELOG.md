# Histórico de versões

## 1.3.0

- **Diz como correu:** com os ganchos `PostToolUse`/`PostToolUseFailure`, a voz diz «Os 38 testes passaram», «Falharam 3 testes», «A compilação falhou», «Push feito», e a duração dos comandos de mais de um minuto. Um `grep` sem resultados não conta como falha: só testes, compilações, instalações, pushes e publicações.
- **Ilha:** fica vermelha (e abana) quando um desses comandos falha, mostra um **cronómetro** enquanto um comando corre, o progresso da lista de tarefas («4/7», incluindo o plano da app do Claude) e «A compactar a conversa».
- **Sub-agentes:** pontinhos a orbitar o avatar da conversa enquanto trabalham, e a lista no cartão da conversa. A linha temporal marca a vermelho as ações que falharam e mostra quanto demoraram.
- **Permissões:** botão **«Sempre»** com a regra que o próprio Claude Code sugere (ex.: `git push:*`, «Aceitar edições»), e o **diff colorido** do que um Edit/Write vai mudar.
- **Respostas longas:** depois do limite, a voz diz os temas que ficaram por ler e, se a mensagem acaba numa pergunta, a pergunta.
- **Sons** curtos (passou, falhou, autorização, terminou, a ouvir), gerados no PC, e **som espacial**: com várias conversas, cada uma fala do seu lado.
- **Calada em reuniões:** microfone ocupado por outra app ou programa em ecrã inteiro/apresentação = voz em silêncio (o ícone da lua fica roxo e diz porquê).
- **«Enquanto estiveste fora»:** depois de 5 minutos sem rato nem teclado, ao voltares a voz e a ilha resumem o que terminou, falhou ou precisa de ti.
- **Custo:** os tokens em euros (taxa diária do BCE) ou dólares, ao preço público de cada modelo, por dia e por conversa.
- **«A tua semana»:** um cartão com tokens, horas ativas, conversas, dias seguidos, dia e hora de ponta, projetos e ferramentas mais usadas, para copiar ou guardar como imagem.
- **Mãos-livres** (desligado por omissão): depois de cada resposta a barra ouve-te, pára sozinha quando te calas e envia para a conversa; «obrigado» ou «chega» terminam. O atalho de falar, neste modo, envia logo.
- **Autorizar por voz** (desligado por omissão): «Site pede autorização para correr git. Autorizas?» — responde «sim», «não» ou «sempre».

## 1.2.3

- **Barra flutuante corrigida:** esticava sem parar (chegava a ficar mais larga do que o ecrã). A largura medida passou a ser a do conteúdo, não a da janela, e a ilha tem um lugar fixo nesta posição, para a barra não mudar de tamanho a cada frase.

## 1.2.2

- **Ícone na área de notificação:** a barra tem agora um ícone laranja ao pé do relógio. «Esconder a barra» (clique direito) tira-a do ecrã mas deixa o ícone; um clique nele mostra-a outra vez. No menu do ícone: mostrar/esconder, não incomodar e sair. Da primeira vez que a escondes, o Windows avisa onde ela ficou.
- Voltar a abrir a barra (`/voz:barra abrir`, o arranque com o Windows ou o próprio .exe) com ela escondida mostra a que já está a correr, em vez de não fazer nada.
- A barra e os menus já não ficam minimizados e perdidos (Win+M, «mostrar o ambiente de trabalho»): voltam logo ao sítio.

## 1.2.1

- Capturas novas no README (ilha dinâmica, cartão de conversa, Centro de Controlo, autorização e clique direito).
- Corrigido «57 Mil tokens» no cartão de conversa (maiúscula a mais).
- `?previa=1` força o modo de pré-visualização da barra dentro de um WebView2 (para capturas).

## 1.2.0

- **Ilha dinâmica:** uma cápsula de vidro no centro da barra mostra o que se passa — a ação da conversa em foco, a legenda e a onda enquanto a voz fala, «X pede autorização» com halo âmbar, «X terminou» com um check animado e o ditado a ouvir-te. Cresce e encolhe com uma curva com mola; clicar nela autoriza, salta a fala ou abre a conversa.
- **Os cartões saem da ilha:** pedidos de autorização, avisos e ditado abrem centrados por baixo dela (antes iam para o canto).
- **Avatares com anel:** cada conversa tem a sua cor; o anel enche com o contexto usado, roda enquanto trabalha e pulsa quando precisa de ti. Clicar num avatar abre o cartão dessa conversa com a **linha temporal** das últimas ações.
- **Centro de Controlo em mosaicos:** voz, ler respostas, anunciar ações, não incomodar, pausar/saltar, volume, velocidade e tom, tokens do dia com gráfico, língua, aspeto e a posição da barra em miniaturas; equalizador num painel que abre.
- **Clique direito curto:** conversas, Centro de Controlo, tokens, não incomodar, voz, definições e fechar.

## 1.1.0

- **Interface em inglês e espanhol:** a barra (menus, definições, conversas, tokens, permissões) e as frases faladas («A ler config.ts», «Preciso da tua autorização»…) existem em português, inglês e espanhol.
- **Língua automática:** segue a língua do Windows (`idioma: "auto"`); muda-se no clique direito ou nas definições. Se não houver voz instalada para a língua escolhida, a barra oferece o download da voz recomendada (tugão, lessac, davefx).
- Os anúncios usam uma voz instalada na língua da interface, e o ditado transcreve nessa língua por omissão (`ditadoIdioma: "auto"`).

## 1.0.0

Primeira versão estável, pronta para quem a quiser instalar.

- **Aprovar permissões pela barra:** os pedidos de autorização aparecem num cartão com o comando exato e os botões *Permitir* / *Recusar*. Na app do Claude corre ao lado do diálogo normal (vale quem decidir primeiro).
- **Falar com o Claude:** botão 🎤 na barra e em cada conversa (ou `Ctrl+Shift+Alt+V`); grava, transcreve localmente com o Whisper e põe o texto na caixa de resposta para reveres. Instala-se com `/voz:instalar ouvir`.
- **Atalhos globais** `Ctrl+Shift+Alt` + `V` (falar), `P` (pausar), `N` (saltar), `C` (conversas), `D` (não incomodar).
- **Não incomodar:** botão na barra, no clique direito e no atalho, e horário de silêncio (ex.: 22:00 → 08:00). Sem voz nem avisos no ecrã.
- **Vozes e idiomas:** catálogo com as vozes Piper de 11 idiomas, download com verificação MD5, voz principal, voz e tom por conversa, e idioma automático (uma resposta em inglês usa a voz inglesa instalada). `/voz:vozes`.
- **Tokens do dia:** gráfico dos últimos 7 dias, totais de hoje e as conversas que mais gastaram (clica no anel do contexto).
- **Clique direito na barra:** conversas, som, tokens, não incomodar, posição, ecrã, aspeto, definições e fechar.
- **Vários monitores:** escolhe em que ecrã fica a barra.
- **Instalação mais fácil:** sem Python no sistema, o instalador usa o `uv` (traz o seu próprio Python); `/voz:instalar tudo`.
- **A barra recompila-se sozinha** quando uma atualização do plugin traz uma versão nova do anfitrião.
- Porta do servidor local livre automaticamente (47821 ou as seguintes), ícone do plugin, testes automáticos no GitHub (Windows, Linux, macOS).

## 0.4.x

- Conversas na barra: avatares animados, painel com a última mensagem e respostas diretas (gancho `asyncRewake`); aviso no canto quando uma conversa termina.
- Modo claro ao estilo macOS e botão Automático / Claro / Escuro.

## 0.3.x

- Barra do Windows ao estilo da barra de menus do macOS (seis posições, módulos, arranque com o Windows), botão «Testar a voz» e pronúncia «Cláude».

## 0.2.x

- Voz «tugão» mais calma; som afinável (volume, altura, equalizador, predefinições).

## 0.1.0

- Primeira versão: narração em português de Portugal, em tempo real, com o Piper.
