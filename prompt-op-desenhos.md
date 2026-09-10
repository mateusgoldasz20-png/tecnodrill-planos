# Prompt para refazer o OP + Desenho em outra conta

Este arquivo guarda um prompt **autossuficiente**: quem receber não precisa deste
repositório nem do histórico da conversa. Copie tudo entre as linhas `---` e cole.

Se a outra conta tiver acesso ao repositório, é mais simples mandar ler
`ordem-producao-desenhos.md` direto — este prompt existe para o caso em que ela **não** tem.

---

Você vai construir uma ferramenta interna para a Tecnodrill, fabricante de perfuratrizes.
Fale comigo em português do Brasil.

## O problema

Para levar uma ordem de produção ao chão de fábrica, hoje alguém faz isto à mão, dezenas de
vezes por semana:

1. Salva o PDF da OP exportada do sistema SIGER. O nome do arquivo é o código do produto:
   8 dígitos, por exemplo `95700004`.
2. Abre o servidor de engenharia, pasta `Projetos`.
3. Entra na pasta da família (são 9 pastas, de `1` a `9`).
4. Acha a pasta do projeto no meio de dezenas.
5. Entra na pasta de desenhos.
6. Procura o PDF do desenho no meio de centenas de arquivos.
7. Copia o desenho para a pasta `OP para imprimir`.
8. Junta OP + desenho em um único PDF e manda imprimir.

Os dois erros caros são imprimir o **desenho errado** e imprimir uma **revisão obsoleta**.

## O que construir

Uma página que recebe o PDF da OP, localiza sozinha o desenho no servidor, junta os dois em um
único PDF e grava em `OP para imprimir / Prontos`, pronto para imprimir. Sem digitação: o nome do
arquivo da OP já carrega toda a informação necessária.

## Regra de localização — confirmada com a engenharia, siga ao pé da letra

O código de 8 dígitos tem a máscara `ABBCCDDD`:

- `A` → pasta de 1º nível dentro de `Projetos` (1 a 9)
- `A.BB` → pasta do projeto
- `A.BB.CC.DDD` → nome do arquivo do desenho

```
95700004  →  Projetos / 9 / 9.57 / Desenho PDF / 9.57.00.004.pdf
```

1. **O SIGER escreve sem pontos; a engenharia nomeia com pontos.** Ignore os pontos ao comparar.
2. **Casamento só por igualdade exata** dos 8 dígitos do *token líder* do nome (o pedaço antes do
   primeiro espaço, hífen ou underscore). Nunca use "começa com": senão `9.57.00.0045` casaria
   com `95700004`. Este é o erro mais perigoso do projeto inteiro.
3. **Arquivos cujo nome começa com `REV` são revisão antiga e nunca podem ser usados.** O desenho
   vigente nunca tem `REV` no nome. Exija `REV` como token — `^\s*REV(?![A-Za-zÀ-ÿ])` — para não
   descartar por engano um desenho legítimo chamado `REVESTIMENTO 9.57.00.004.pdf`.
4. **Os PDFs ficam todos soltos na raiz** da pasta de desenhos. Varredura de um nível só, não
   recursiva.
5. **Nomes de pasta têm sufixos.** Case por prefixo com fronteira (espaço, `-` ou `_`): o alvo
   `9.57` casa com `9.57 - Perfuratriz X` e com `9.57_MAQ`, mas **não** com `9.5` nem com `9.570`.
   O alvo `9` não pode casar com a pasta `9.57`.
6. **A pasta de desenhos** pode se chamar `Desenho` ou `Desenho PDF`. Aceite qualquer pasta cujo
   nome, normalizado (sem acentos, em maiúsculas), contenha `DESENHO`, preferindo `DESENHO PDF`
   quando houver mais de uma.

## Restrições técnicas — são reais, não são preferências

- **Um arquivo `.html` único**, sem build e sem instalação. Quem usa é a produção, não instala nada.
  Vai ser publicado no GitHub Pages.
- **File System Access API** (`showDirectoryPicker`) para ler o servidor. O navegador não abre
  `\\servidor-engenharia\...` por caminho digitado — a pessoa escolhe a pasta uma vez no seletor
  do Windows e o app navega sozinho dali para baixo.
- Duas pastas: `Projetos` em modo `read`, `OP para imprimir` em modo `readwrite`.
- **Guarde os handles em IndexedDB**, para não obrigar a escolher as pastas toda sessão. O
  navegador ainda vai exigir um clique para reativar a permissão — deixe isso claro na interface,
  senão parece defeito.
- **pdf-lib via CDN** para juntar os PDFs. Carregue com `{ignoreEncryption:true}`: alguns desenhos
  escaneados vêm protegidos.
- Chrome e Edge. Se `showDirectoryPicker` não existir, degrade com elegância: a pessoa ainda deve
  conseguir arrastar o PDF da OP e anexar o desenho à mão.
- Interface inteira em português do Brasil.

## Comportamento

- **Entrada:** arrastar PDFs de OP para a tela, ou varrer a pasta `OP para imprimir` inteira de
  uma vez. Extraia o código de 8 dígitos do nome do arquivo.
- **Saída:** `OP para imprimir / Prontos / 95700004 - OP + Desenho.pdf` — as páginas da OP,
  depois as páginas do desenho, sem redimensionar nada.
- **Nunca mova nem renomeie os originais.** Só ler de `Projetos`, só escrever em `Prontos`.
- Fila com status por OP, processamento em lote sequencial (a rede não gosta de paralelismo).
- **Cache do índice da pasta de desenhos por projeto:** varrer uma pasta com centenas de arquivos
  por unidade de rede é lento, e várias OPs do mesmo projeto costumam sair no mesmo lote.
- Log de auditoria exportável em CSV: qual arquivo foi usado, de qual caminho, em que hora.

## Mensagens de erro

Nunca um "não encontrado" genérico. Cada falha tem que dizer exatamente onde parou:

- `Família 9 não encontrada dentro de Projetos`
- `Projeto 9.57 não existe na família 9`
- `Projeto 9.57 não tem pasta Desenho / Desenho PDF`
- `Desenho 9.57.00.004 não encontrado — 142 arquivo(s) varridos em <caminho>`
- `Só existe versão REV de 9.57.00.004 (REV 9.57.00.004.pdf) — revisão antiga, confira com a engenharia`

Quando o nome exato não bater, faça uma segunda varredura tolerante (dígitos do nome inteiro) e
apresente o resultado como **candidatos a confirmar**. Nunca escolha sozinho. O mesmo vale quando
mais de um arquivo casa exatamente: mostre os dois e deixe a pessoa clicar.

Uma OP com problema não pode travar o lote. Deixe resolver à mão, linha a linha.

## Testes que o resultado precisa passar

1. `9.57.00.0045.pdf` não casa com `95700004`.
2. `REV 9.57.00.004.pdf` é descartado; `REVESTIMENTO 9.57.00.004.pdf` não é.
3. O alvo `9.57` não casa com `9.570` nem com `9.5`, e casa com `9.57 - Perfuratriz X`.
4. O alvo `9` não casa com a pasta `9.57`.
5. OP de 2 páginas + desenho de 1 página resulta em PDF de 3 páginas, com a OP primeiro.
6. Dois arquivos com o mesmo código pedem confirmação em vez de escolher um.
7. Pasta que só tem o `REV` produz a mensagem específica, não "não encontrado".

Entregue o arquivo `.html` completo, me diga como testar, e me avise de qualquer suposição que
você precisou fazer sobre a estrutura do servidor.

---
