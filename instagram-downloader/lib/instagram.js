'use strict';

/*
 * Resolve um link do Instagram (reel ou post publico) para as URLs de midia.
 *
 * Tenta quatro caminhos, do mais confiavel para o mais improvisado:
 *   1. yt-dlp, se estiver instalado na maquina;
 *   2. a pagina de embed do post (/embed/captioned/);
 *   3. a API GraphQL publica;
 *   4. as meta tags og: da propria pagina do post.
 *
 * Nada disso passa por login: so' funciona com conteudo publico.
 */

const { spawn } = require('node:child_process');

const APP_ID = '936619743392459';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

/* Hosts de onde o servidor aceita baixar. Sem isso o /api/arquivo viraria um
   proxy aberto que qualquer aba do navegador poderia usar pra qualquer coisa. */
const HOSTS_MIDIA = [
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)instagram\.com$/i
];

class ErroAmigavel extends Error {
  constructor(mensagem, detalhes){ super(mensagem); this.amigavel = true; this.detalhes = detalhes || []; }
}

function hostPermitido(endereco){
  try { return HOSTS_MIDIA.some(re => re.test(new URL(endereco).hostname)); }
  catch { return false; }
}

/* ─────────────────────────── link e shortcode ─────────────────────────── */

/* O segmento opcional cobre links do tipo /usuario/reel/CODIGO/. Links de
   compartilhamento (/share/reel/TOKEN) ficam de fora de proposito: ali o
   token nao e' o shortcode, so' o redirecionamento revela o post. */
const RE_CODIGO = /instagram\.com\/(?:(?!share\/)[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i;

function extrairShortcode(entrada){
  const m = String(entrada || '').match(RE_CODIGO);
  return m ? m[1] : null;
}

function normalizarEntrada(entrada){
  let alvo = String(entrada || '').trim().replace(/^["'<]+|["'>]+$/g, '');
  if (!alvo) throw new ErroAmigavel('Cole o link do reel ou do post.');
  if (!/^https?:\/\//i.test(alvo)) alvo = 'https://' + alvo.replace(/^\/+/, '');
  let u;
  try { u = new URL(alvo); } catch { throw new ErroAmigavel('Isso nao parece um link valido.'); }
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) {
    throw new ErroAmigavel('So aceito links do instagram.com.');
  }
  return u.toString();
}

/* ──────────────────────────── utilitarios ─────────────────────────────── */

function limparUrl(bruta){
  return String(bruta)
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

function decodificarTexto(bruto){
  if (bruto == null) return null;
  try { return JSON.parse('"' + bruto + '"'); } catch {}
  return String(bruto)
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/* A pagina de embed devolve JSON dentro de string JSON, entao boa parte do
   conteudo vem com escape duplo. Guardamos as duas leituras e procuramos nas
   duas. */
function desescapar(html){
  return String(html).replace(/\\"/g, '"').replace(/\\\\\//g, '/').replace(/\\\//g, '/');
}

function acharPrimeiro(variantes, padroes){
  for (const texto of variantes){
    for (const re of padroes){
      const m = texto.match(re);
      if (m && m[1]) return m[1];
    }
  }
  return null;
}

async function pegarTexto(endereco, extras){
  const resposta = await fetch(endereco, {
    headers: Object.assign({
      'user-agent': UA,
      'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'sec-fetch-mode': 'navigate'
    }, extras || {}),
    redirect: 'follow',
    signal: AbortSignal.timeout(20000)
  });
  if (!resposta.ok) throw new Error('o Instagram respondeu ' + resposta.status);
  return await resposta.text();
}

/* ──────────────────────────── 1. yt-dlp ───────────────────────────────── */

function rodar(comando, argumentos, tempoLimite){
  return new Promise((ok, falha) => {
    let processo;
    try { processo = spawn(comando, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return falha(new Error('nao consegui executar (' + e.message + ')')); }

    let saida = '', erro = '';
    const relogio = setTimeout(() => { processo.kill('SIGKILL'); falha(new Error('demorou demais')); }, tempoLimite || 60000);

    processo.stdout.on('data', d => { saida += d; });
    processo.stderr.on('data', d => { erro += d; });
    processo.on('error', e => {
      clearTimeout(relogio);
      falha(new Error(e.code === 'ENOENT' ? 'nao esta instalado' : e.message));
    });
    processo.on('close', codigo => {
      clearTimeout(relogio);
      if (codigo === 0) return ok(saida);
      const ultima = erro.trim().split('\n').filter(Boolean).pop();
      falha(new Error(ultima || ('terminou com codigo ' + codigo)));
    });
  });
}

function melhorFormato(no){
  const lista = Array.isArray(no.formats) ? no.formats : [];
  const videos = lista.filter(f => f.url && f.vcodec && f.vcodec !== 'none');
  if (!videos.length) return null;
  videos.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
  return videos[0];
}

async function viaYtDlp(link){
  const bruto = await rodar('yt-dlp', ['-J', '--no-warnings', '--no-playlist', '--', link]);
  const dados = JSON.parse(bruto);
  const nos = Array.isArray(dados.entries) && dados.entries.length ? dados.entries : [dados];

  const itens = [];
  for (const no of nos){
    const formato = melhorFormato(no);
    const endereco = (formato && formato.url) || no.url;
    if (!endereco) continue;
    const ehVideo = (no.vcodec && no.vcodec !== 'none') || !!formato || no.ext === 'mp4';
    if (!ehVideo) continue;
    itens.push({
      tipo: 'video',
      url: endereco,
      largura: (formato && formato.width) || no.width || null,
      altura: (formato && formato.height) || no.height || null,
      tamanho: (formato && (formato.filesize || formato.filesize_approx)) || no.filesize || no.filesize_approx || null,
      miniatura: no.thumbnail || null
    });
  }

  return {
    autor: dados.uploader_id || dados.uploader || dados.channel || null,
    legenda: dados.description || null,
    duracao: dados.duration || null,
    miniatura: dados.thumbnail || null,
    itens
  };
}

/* ───────────────────── 2 e 4. leitura do HTML ─────────────────────────── */

const PADROES_VIDEO = [
  /"video_url"\s*:\s*"([^"]+)"/g,
  /"playback_url"\s*:\s*"([^"]+)"/g,
  /"video_versions"[\s\S]{0,400}?"url"\s*:\s*"([^"]+)"/g,
  /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
  /<video[^>]+src=["']([^"']+)["']/gi
];

function lerHtml(html){
  const variantes = [html, desescapar(html)];

  /* Um mesmo video aparece varias vezes com parametros de CDN diferentes.
     Deduplicamos pelo caminho do arquivo, ficando com a primeira ocorrencia. */
  const porCaminho = new Map();
  for (const texto of variantes){
    for (const re of PADROES_VIDEO){
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(texto)) !== null){
        const endereco = limparUrl(m[1]);
        if (!hostPermitido(endereco)) continue;
        let chave;
        try { chave = new URL(endereco).pathname; } catch { continue; }
        if (!porCaminho.has(chave)) porCaminho.set(chave, endereco);
      }
    }
  }

  const largura = acharPrimeiro(variantes, [/"dimensions"\s*:\s*\{[^}]*?"width"\s*:\s*(\d+)/, /"original_width"\s*:\s*(\d+)/]);
  const altura  = acharPrimeiro(variantes, [/"dimensions"\s*:\s*\{[^}]*?"height"\s*:\s*(\d+)/, /"original_height"\s*:\s*(\d+)/]);

  const itens = [...porCaminho.values()].map(endereco => ({
    tipo: 'video',
    url: endereco,
    largura: largura ? Number(largura) : null,
    altura: altura ? Number(altura) : null,
    tamanho: null,
    miniatura: null
  }));

  const duracao = acharPrimeiro(variantes, [/"video_duration"\s*:\s*([0-9.]+)/]);
  const miniatura = acharPrimeiro(variantes, [
    /"display_url"\s*:\s*"([^"]+)"/,
    /"thumbnail_src"\s*:\s*"([^"]+)"/,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  ]);
  const legenda = acharPrimeiro(variantes, [
    /"edge_media_to_caption"[\s\S]{0,300}?"text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    /"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/
  ]);
  const autor = acharPrimeiro(variantes, [
    /"owner"\s*:\s*\{[\s\S]{0,300}?"username"\s*:\s*"([^"]+)"/,
    /"username"\s*:\s*"([^"]+)"/
  ]);

  return {
    autor: autor || null,
    legenda: decodificarTexto(legenda),
    duracao: duracao ? Number(duracao) : null,
    miniatura: miniatura ? limparUrl(miniatura) : null,
    itens
  };
}

async function viaEmbed(link, codigo){
  const html = await pegarTexto('https://www.instagram.com/p/' + codigo + '/embed/captioned/');
  const lido = lerHtml(html);
  if (!lido.itens.length && /\blogin\b/i.test(html)){
    throw new Error('a pagina de embed pediu login (post provavelmente privado)');
  }
  return lido;
}

async function viaPagina(link){
  const html = await pegarTexto(link, { 'x-ig-app-id': APP_ID });
  return lerHtml(html);
}

/* ──────────────────────────── 3. GraphQL ──────────────────────────────── */

function daMidiaGraphql(midia){
  const filhos = midia?.edge_sidecar_to_children?.edges;
  const nos = Array.isArray(filhos) && filhos.length ? filhos.map(e => e.node) : [midia];

  const itens = [];
  for (const no of nos){
    if (!no || !no.video_url) continue;
    itens.push({
      tipo: 'video',
      url: limparUrl(no.video_url),
      largura: no.dimensions?.width || null,
      altura: no.dimensions?.height || null,
      tamanho: null,
      miniatura: no.display_url ? limparUrl(no.display_url) : null
    });
  }

  return {
    autor: midia?.owner?.username || null,
    legenda: midia?.edge_media_to_caption?.edges?.[0]?.node?.text || null,
    duracao: midia?.video_duration || null,
    miniatura: midia?.display_url ? limparUrl(midia.display_url) : null,
    itens
  };
}

async function viaGraphql(link, codigo){
  const corpo = new URLSearchParams({
    doc_id: '10015901848480474',
    variables: JSON.stringify({ shortcode: codigo })
  });

  const resposta = await fetch('https://www.instagram.com/graphql/query', {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded',
      'x-ig-app-id': APP_ID,
      'accept': '*/*',
      'referer': link
    },
    body: corpo,
    signal: AbortSignal.timeout(20000)
  });
  if (!resposta.ok) throw new Error('a API respondeu ' + resposta.status);

  const dados = await resposta.json();
  const midia = dados?.data?.xdt_shortcode_media || dados?.data?.shortcode_media;
  if (!midia) throw new Error('resposta sem midia (post privado ou exigindo login)');
  return daMidiaGraphql(midia);
}

/* ───────────────────────────── orquestra ──────────────────────────────── */

const ESTRATEGIAS = [
  ['yt-dlp', viaYtDlp],
  ['embed', viaEmbed],
  ['graphql', viaGraphql],
  ['pagina', viaPagina]
];

async function resolver(entrada){
  const link = normalizarEntrada(entrada);

  let codigo = extrairShortcode(link);
  if (!codigo){
    /* Links de compartilhamento (/share/...) so' revelam o post depois do
       redirecionamento. */
    try {
      const resposta = await fetch(link, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      codigo = extrairShortcode(resposta.url);
    } catch {}
  }
  if (!codigo){
    throw new ErroAmigavel('Nao achei o codigo do post nesse link. Use o endereco de um reel ou post, tipo instagram.com/reel/ABCdef123/.');
  }

  const canonico = 'https://www.instagram.com/p/' + codigo + '/';
  const falhas = [];

  for (const [nome, estrategia] of ESTRATEGIAS){
    try {
      const resultado = await estrategia(canonico, codigo);
      if (resultado && resultado.itens && resultado.itens.length){
        return Object.assign({ fonte: nome, shortcode: codigo, link: canonico }, resultado);
      }
      falhas.push(nome + ': nao encontrou video');
    } catch (e){
      falhas.push(nome + ': ' + e.message);
    }
  }

  throw new ErroAmigavel(
    'Nao consegui pegar o video desse post. Confira se ele e publico — perfis privados e stories precisam de login, e isso aqui nao faz.',
    falhas
  );
}

module.exports = { resolver, hostPermitido, extrairShortcode, lerHtml, ErroAmigavel, UA };
