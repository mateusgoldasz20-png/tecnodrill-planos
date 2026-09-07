# Baixador de Reels

Ferramenta pessoal para salvar em MP4 vídeos de **reels e posts públicos** do Instagram.

> Uso pessoal — não tem relação com os sistemas da Tecnodrill que ficam na raiz deste repositório.

## Como usar

Precisa só do [Node.js](https://nodejs.org) 18 ou mais novo. **Não tem `npm install`** — o projeto não usa nenhuma dependência externa.

```bash
cd instagram-downloader
node servidor.js
```

Abra <http://localhost:8787>, cole o link e clique em **Buscar**. Aparece uma prévia com autor, legenda, duração e resolução; o botão **Baixar MP4** salva o arquivo com barra de progresso.

Para usar outra porta:

```bash
node servidor.js 9000
```

## Por que precisa de um servidor

Uma página HTML sozinha não dá conta. O Instagram não libera CORS e o CDN de mídia recusa requisição vinda de outra origem, então o navegador é barrado nas duas pontas. O `servidor.js` faz essas duas chamadas fora do navegador e entrega o arquivo pronto para a página.

Ele escuta só em `127.0.0.1` — nada fica exposto na rede.

## Como o link é resolvido

O `lib/instagram.js` tenta quatro caminhos, parando no primeiro que trouxer vídeo:

| # | Caminho | Observação |
|---|---------|-----------|
| 1 | **yt-dlp** | Melhor opção, se estiver instalado. É um projeto ativo, que acompanha as mudanças do Instagram. |
| 2 | **Página de embed** (`/embed/captioned/`) | Não precisa de login e costuma ser o mais estável dos caminhos próprios. |
| 3 | **API GraphQL pública** | Depende de um `doc_id` que a Meta troca de tempos em tempos. |
| 4 | **Meta tags `og:` da página** | Último recurso. |

**Recomendo instalar o yt-dlp**, que deixa tudo bem mais confiável:

```bash
pipx install yt-dlp     # ou: brew install yt-dlp / winget install yt-dlp
```

Estando no PATH, ele é usado automaticamente. Se não estiver, os outros três caminhos assumem.

Quando todos falham, a interface mostra o que **cada tentativa** respondeu (em "Ver o que cada tentativa respondeu"), o que ajuda a saber se o problema foi o post ser privado, o link estar errado ou algum caminho ter quebrado.

## Limites

- **Só conteúdo público.** Perfis privados e stories exigem login, e isso aqui não faz login nem guarda sessão.
- **Só vídeo.** Post que só tem foto é recusado com aviso.
- **Endereços de mídia expiram.** As URLs do CDN valem poucas horas. Se o download falhar com erro do Instagram, é só buscar o post de novo.
- Instagram muda de estrutura sem avisar. Os caminhos 2 a 4 podem parar de funcionar de uma hora para outra — mais um motivo para ter o yt-dlp instalado.

## Estrutura

```
instagram-downloader/
├── servidor.js           servidor HTTP local e rotas da API
├── lib/instagram.js      resolve o link nas URLs de mídia
└── publico/              interface (index.html, estilo.css, app.js)
```

Duas rotas de API:

- `POST /api/resolver` — recebe `{ link }`, devolve autor, legenda, miniatura e a lista de vídeos.
- `GET /api/arquivo?u=&nome=` — baixa a mídia e repassa como anexo.

O `/api/arquivo` **só aceita endereços em `cdninstagram.com`, `fbcdn.net` e `instagram.com`**. Sem essa trava o servidor viraria um proxy aberto que qualquer aba do navegador poderia usar para alcançar qualquer coisa, inclusive a sua própria rede local. Requisições de API vindas de outra origem também são recusadas.

## Situação dos testes

Já verificado, com testes rodados:

- extração de shortcode nos formatos `/p/`, `/reel/`, `/reels/`, `/tv/`, `/usuario/reel/` e links de compartilhamento;
- leitura do HTML nos dois formatos de escape que o Instagram usa, com autor, legenda, miniatura, duração, dimensões e remoção de vídeos repetidos;
- rotas do servidor, arquivos estáticos e todas as mensagens de erro;
- as travas de segurança: path traversal, proxy aberto (incluindo `file://`, `127.0.0.1` e domínios do tipo `cdninstagram.com.evil.io`) e origem não autorizada.

**Não verificado:** as quatro estratégias contra o Instagram de verdade. Foram escritas a partir da estrutura conhecida das respostas, mas o ambiente onde este código foi feito bloqueia `instagram.com` por política de rede, então a primeira execução real vai ser na sua máquina. Se algum caminho vier quebrado, o detalhamento de erro na tela diz qual foi.
