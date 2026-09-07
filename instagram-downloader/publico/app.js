'use strict';

const formulario = document.getElementById('formulario');
const campoLink = document.getElementById('link');
const botaoBuscar = document.getElementById('botaoBuscar');
const aviso = document.getElementById('aviso');
const resultado = document.getElementById('resultado');
const molde = document.getElementById('moldeItem');

/* ----------------------------- ajudinhas ----------------------------- */

function mostrarAviso(titulo, texto, detalhes, ehErro){
  aviso.className = 'aviso' + (ehErro ? ' erro' : '');
  aviso.innerHTML = '';

  if (titulo){
    const forte = document.createElement('strong');
    forte.textContent = titulo;
    aviso.appendChild(forte);
  }
  if (texto) aviso.appendChild(document.createTextNode(texto));

  if (detalhes && detalhes.length){
    const bloco = document.createElement('details');
    const resumo = document.createElement('summary');
    resumo.textContent = 'Ver o que cada tentativa respondeu';
    const lista = document.createElement('ul');
    for (const linha of detalhes){
      const item = document.createElement('li');
      item.textContent = linha;
      lista.appendChild(item);
    }
    bloco.append(resumo, lista);
    aviso.appendChild(bloco);
  }

  aviso.hidden = false;
}

function esconderAviso(){ aviso.hidden = true; }

function formatarDuracao(segundos){
  if (!segundos) return null;
  const total = Math.round(segundos);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function formatarTamanho(bytes){
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
}

const NOMES_FONTE = {
  'yt-dlp': 'via yt-dlp',
  'embed': 'via página de embed',
  'graphql': 'via API pública',
  'pagina': 'via meta tags da página'
};

/* ------------------------------ montagem ----------------------------- */

function montarCartao(dados, item){
  const no = molde.content.firstElementChild.cloneNode(true);

  const capa = no.querySelector('.capa img');
  if (item.miniatura){
    capa.src = item.miniatura;
    capa.addEventListener('error', () => { capa.hidden = true; }, { once: true });
  } else {
    capa.hidden = true;
  }

  no.querySelector('.autor').textContent = dados.autor ? '@' + dados.autor : 'Autor não identificado';
  const codigo = document.createElement('span');
  codigo.textContent = dados.shortcode;
  no.querySelector('.autor').appendChild(codigo);

  no.querySelector('.legenda').textContent = (dados.legenda || '').trim();

  const etiquetas = no.querySelector('.etiquetas');
  const marcas = [
    item.largura && item.altura ? item.largura + '×' + item.altura : null,
    formatarDuracao(dados.duracao),
    formatarTamanho(item.tamanho),
    NOMES_FONTE[dados.fonte] || dados.fonte
  ].filter(Boolean);
  for (const marca of marcas){
    const chip = document.createElement('span');
    chip.textContent = marca;
    etiquetas.appendChild(chip);
  }

  no.querySelector('.abrir').href = item.url;

  const botao = no.querySelector('.baixar');
  const barra = no.querySelector('.progresso');
  const preenchimento = barra.querySelector('span');
  const recado = no.querySelector('.recado');

  botao.addEventListener('click', () => baixar({ item, botao, barra, preenchimento, recado }));

  return no;
}

function mostrarResultado(dados){
  resultado.innerHTML = '';
  for (const item of dados.itens) resultado.appendChild(montarCartao(dados, item));
  resultado.hidden = false;
}

/* ------------------------------- buscar ------------------------------ */

async function buscar(link){
  botaoBuscar.disabled = true;
  botaoBuscar.classList.add('ocupado');
  esconderAviso();
  resultado.hidden = true;

  try {
    const resposta = await fetch('/api/resolver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link })
    });
    const dados = await resposta.json();

    if (!resposta.ok){
      mostrarAviso('Não deu certo', dados.erro || 'Erro desconhecido.', dados.detalhes, true);
      return;
    }
    if (!dados.itens.length){
      mostrarAviso('Nada para baixar', 'Esse post não tem vídeo — parece ser só foto.', null, true);
      return;
    }

    mostrarResultado(dados);
  } catch (e){
    mostrarAviso('Servidor fora do ar', 'Não consegui falar com o servidor local. Confira se o "node servidor.js" ainda está rodando no terminal.', null, true);
  } finally {
    botaoBuscar.disabled = false;
    botaoBuscar.classList.remove('ocupado');
  }
}

/* ------------------------------- baixar ------------------------------ */

async function baixar({ item, botao, barra, preenchimento, recado }){
  botao.disabled = true;
  botao.textContent = 'Baixando...';
  botao.classList.remove('pronto');
  recado.hidden = true;
  recado.className = 'recado';
  barra.hidden = false;
  barra.classList.add('indefinida');
  preenchimento.style.width = '';

  try {
    const endereco = '/api/arquivo?' + new URLSearchParams({ u: item.url, nome: item.nome });
    const resposta = await fetch(endereco);

    if (!resposta.ok){
      const erro = await resposta.json().catch(() => ({}));
      throw new Error(erro.erro || ('o servidor respondeu ' + resposta.status));
    }

    const total = Number(resposta.headers.get('content-length') || 0);
    let lido = 0;
    const pedacos = [];
    const leitor = resposta.body.getReader();

    if (total){
      barra.classList.remove('indefinida');
      preenchimento.style.width = '0%';
    }

    for (;;){
      const { done, value } = await leitor.read();
      if (done) break;
      pedacos.push(value);
      lido += value.length;
      if (total) preenchimento.style.width = Math.min(100, (lido / total) * 100).toFixed(1) + '%';
    }

    barra.classList.remove('indefinida');
    preenchimento.style.width = '100%';

    const arquivo = new Blob(pedacos, { type: 'video/mp4' });
    const temporario = URL.createObjectURL(arquivo);
    const atalho = document.createElement('a');
    atalho.href = temporario;
    atalho.download = item.nome;
    document.body.appendChild(atalho);
    atalho.click();
    atalho.remove();
    setTimeout(() => URL.revokeObjectURL(temporario), 60000);

    botao.textContent = 'Baixado';
    botao.classList.add('pronto');
    recado.textContent = item.nome + ' — ' + formatarTamanho(arquivo.size);
    recado.hidden = false;
  } catch (e){
    barra.hidden = true;
    botao.textContent = 'Tentar de novo';
    botao.disabled = false;
    recado.className = 'recado erro';
    recado.textContent = e.message;
    recado.hidden = false;
  }
}

/* ------------------------------- eventos ----------------------------- */

formulario.addEventListener('submit', evento => {
  evento.preventDefault();
  const link = campoLink.value.trim();
  if (link) buscar(link);
});

campoLink.focus();
