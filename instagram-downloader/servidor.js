'use strict';

/*
 * Servidor local do baixador. Sobe em 127.0.0.1 (so' a sua maquina enxerga),
 * serve a interface e faz o trabalho que o navegador nao pode fazer sozinho:
 * falar com o Instagram e puxar o arquivo do CDN.
 *
 *   node servidor.js            -> http://localhost:8787
 *   node servidor.js 9000       -> outra porta
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const ig = require('./lib/instagram');

const PORTA = Number(process.env.PORTA || process.argv[2] || 8787);
const RAIZ = path.join(__dirname, 'publico');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function responderJson(res, codigo, corpo){
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    'cache-control': 'no-store'
  });
  res.end(texto);
}

function lerCorpo(req, limite){
  return new Promise((ok, falha) => {
    const pedacos = [];
    let total = 0;
    req.on('data', d => {
      total += d.length;
      if (total > (limite || 64 * 1024)){ falha(new Error('corpo grande demais')); req.destroy(); return; }
      pedacos.push(d);
    });
    req.on('end', () => ok(Buffer.concat(pedacos).toString('utf8')));
    req.on('error', falha);
  });
}

/* Qualquer site aberto no navegador consegue mandar requisicao pra localhost.
   Como o servidor e' pessoal e sem login, pelo menos recusamos o que vier
   identificado como outra origem. */
function origemAceita(req){
  const origem = req.headers.origin;
  if (!origem) return true;
  return [
    'http://localhost:' + PORTA,
    'http://127.0.0.1:' + PORTA,
    'http://[::1]:' + PORTA
  ].includes(origem);
}

function nomeSeguro(texto){
  return String(texto || 'video')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'video';
}

/* --------------------------- /api/resolver ---------------------------- */

async function apiResolver(req, res){
  let entrada;
  try {
    const corpo = await lerCorpo(req);
    entrada = JSON.parse(corpo || '{}').link;
  } catch {
    return responderJson(res, 400, { erro: 'Nao entendi o pedido.' });
  }

  try {
    const dados = await ig.resolver(entrada);
    const base = nomeSeguro((dados.autor ? '@' + dados.autor + ' - ' : '') + dados.shortcode);
    responderJson(res, 200, {
      fonte: dados.fonte,
      shortcode: dados.shortcode,
      link: dados.link,
      autor: dados.autor,
      legenda: dados.legenda,
      duracao: dados.duracao,
      miniatura: dados.miniatura,
      itens: dados.itens.map((item, i) => ({
        url: item.url,
        largura: item.largura,
        altura: item.altura,
        tamanho: item.tamanho,
        miniatura: item.miniatura || dados.miniatura || null,
        nome: base + (dados.itens.length > 1 ? ' (' + (i + 1) + ')' : '') + '.mp4'
      }))
    });
  } catch (e){
    if (e && e.amigavel) return responderJson(res, 422, { erro: e.message, detalhes: e.detalhes });
    console.error('[resolver]', e);
    responderJson(res, 500, { erro: 'Deu erro aqui no servidor: ' + e.message });
  }
}

/* --------------------------- /api/arquivo ----------------------------- */

async function apiArquivo(req, res, parametros){
  const endereco = parametros.get('u');
  const nome = nomeSeguro(parametros.get('nome') || 'video.mp4');

  if (!endereco || !ig.hostPermitido(endereco)){
    return responderJson(res, 400, { erro: 'Endereco de midia nao permitido.' });
  }

  let origem;
  try {
    origem = await fetch(endereco, {
      headers: {
        'user-agent': ig.UA,
        'referer': 'https://www.instagram.com/',
        'accept': '*/*'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
  } catch (e){
    return responderJson(res, 502, { erro: 'Nao consegui alcancar o servidor de midia: ' + e.message });
  }

  if (!origem.ok || !origem.body){
    return responderJson(res, 502, {
      erro: 'O Instagram recusou o download (' + origem.status + '). Esses enderecos de midia expiram em algumas horas, entao busque o post de novo.'
    });
  }

  const asciiNome = nome.replace(/[^ -~]/g, '_').replace(/"/g, '');
  const cabecalhos = {
    'content-type': origem.headers.get('content-type') || 'video/mp4',
    'content-disposition': 'attachment; filename="' + asciiNome + '"; filename*=UTF-8\'\'' + encodeURIComponent(nome),
    'cache-control': 'no-store'
  };
  const tamanho = origem.headers.get('content-length');
  if (tamanho) cabecalhos['content-length'] = tamanho;

  res.writeHead(200, cabecalhos);

  const fluxo = Readable.fromWeb(origem.body);
  res.on('close', () => { if (!res.writableEnded) fluxo.destroy(); });
  fluxo.on('error', () => res.destroy());
  fluxo.pipe(res);
}

/* -------------------------- arquivos estaticos ------------------------ */

function servirEstatico(req, res, caminho){
  let relativo;
  if (caminho === '/'){
    relativo = 'index.html';
  } else {
    /* Um caminho tipo "/%" faz o decodeURIComponent lancar. Sem esse cuidado a
       excecao sobe pelo handler e derruba o servidor inteiro. */
    try { relativo = decodeURIComponent(caminho); }
    catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Caminho invalido'); return; }
    relativo = relativo.replace(/^\/+/, '');
  }
  const destino = path.resolve(RAIZ, relativo);

  if (destino !== RAIZ && !destino.startsWith(RAIZ + path.sep)){
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Proibido');
    return;
  }

  fs.readFile(destino, (erro, conteudo) => {
    if (erro){
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nao encontrado');
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(conteudo);
  });
}

/* ------------------------------- rotas -------------------------------- */

const servidor = http.createServer((req, res) => {
  try { atender(req, res); }
  catch (erro){
    console.error('[requisicao]', erro);
    if (!res.headersSent) responderJson(res, 500, { erro: 'Erro inesperado no servidor.' });
    else res.destroy();
  }
});

function atender(req, res){
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return responderJson(res, 400, { erro: 'Requisicao invalida.' }); }

  if (url.pathname.startsWith('/api/')){
    if (!origemAceita(req)) return responderJson(res, 403, { erro: 'Origem nao autorizada.' });
    if (url.pathname === '/api/resolver' && req.method === 'POST') return void apiResolver(req, res);
    if (url.pathname === '/api/arquivo' && req.method === 'GET') return void apiArquivo(req, res, url.searchParams);
    return responderJson(res, 404, { erro: 'Rota inexistente.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD'){
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Metodo nao permitido');
    return;
  }

  servirEstatico(req, res, url.pathname);
}

servidor.on('error', erro => {
  if (erro.code === 'EADDRINUSE'){
    console.error('\n  A porta ' + PORTA + ' ja esta ocupada.');
    console.error('  Tente outra: node servidor.js 9000\n');
    process.exit(1);
  }
  throw erro;
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log('\n  Baixador de reels no ar.');
  console.log('  Abra:  http://localhost:' + PORTA);
  console.log('  Sair:  Ctrl+C\n');
});
