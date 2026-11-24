// =====================================================================
//  FUNÇÕES COMPARTILHADAS — usadas por todas as páginas (site, cliente, dono, barbeiro)
//  Carregue este arquivo primeiro, no <head> da página.
// =====================================================================

const $ = (id) => document.getElementById(id);
const real = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const paraMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const paraHora = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function chaveDia(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dataDe = (iso) => new Date(iso + "T12:00");
const dataBonita = (iso) => dataDe(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const dataCurta = (iso) => dataDe(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const hojeIso = () => chaveDia(new Date());
const porHora = (a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora);
const soma = (lista, f) => lista.reduce((s, x) => s + (Number(f(x)) || 0), 0);

function fmtTel(t) {
  const d = soDigitos(t);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || "—";
}
const linkZap = (t, texto = "WhatsApp") =>
  soDigitos(t).length >= 10 ? `<a href="https://wa.me/55${soDigitos(t)}" target="_blank" rel="noopener">${texto}</a>` : "";

// ===== Pedaços de tela usados em vários lugares =====
const vazio = (txt) => `<p class="sub" style="padding:12px 0">${txt}</p>`;

function chipsProdutos(a) {
  if (!a.produtos?.length) return "";
  return `<div class="chips">${a.produtos.map((p) => `<span class="chip">📦 ${esc(p.nome)} ×${p.qtd}</span>`).join("")}</div>`;
}

// Foto do barbeiro (ou a inicial do nome, se ele não tiver foto)
function fotoOuInicial(b, classe = "") {
  return b.foto
    ? `<img class="avatar ${classe} foto" src="${esc(b.foto)}" alt="Foto de ${esc(b.nome)}" loading="lazy">`
    : `<span class="avatar ${classe}">${esc((b.nome || "?")[0])}</span>`;
}

function ler(chave, padrao) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
}
function salvar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {}
}

// ===== Conversa com o servidor =====
async function api(metodo, caminho, corpo, token) {
  const opcoes = { method: metodo, headers: {} };
  if (token) opcoes.headers.Authorization = "Bearer " + token;
  if (corpo !== undefined) {
    opcoes.headers["Content-Type"] = "application/json";
    opcoes.body = JSON.stringify(corpo);
  }
  let resp;
  try { resp = await fetch(caminho, opcoes); }
  catch { throw new Error("Sem conexão com o servidor. Verifique se ele está ligado."); }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const erro = new Error(dados.erro || "Erro no servidor.");
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

// Aberto direto pelo arquivo (sem o servidor)? Mostra como ligar.
if (location.protocol === "file:") {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML = `
      <div style="max-width:520px;margin:60px auto;padding:24px;font-family:system-ui;color:#f3ece4;background:#1f1a17;border-radius:16px;line-height:1.6">
        <h2>Ligue o servidor primeiro</h2>
        <p>Abra o terminal na pasta do projeto e rode:</p>
        <pre style="background:#000;padding:12px;border-radius:8px">python servidor/servidor.py</pre>
        <p>Depois acesse <b>http://localhost:8000</b>. O servidor é quem junta o header, o footer e os textos do banco em cada página.</p>
      </div>`;
  });
}

function avisar(texto) {
  let el = $("aviso");
  if (!el) {   // a página não tem a caixa de aviso: cria uma
    el = document.createElement("div");
    el.className = "aviso"; el.id = "aviso";
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.classList.add("mostrar");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => el.classList.remove("mostrar"), 2800);
}

function mostrarTela(id) {
  document.querySelectorAll(".tela").forEach((t) => (t.hidden = t.id !== id));
  window.scrollTo(0, 0);
}

// ===== Modo claro / escuro =====
// O padrão é o escuro (preto e dourado). A escolha fica salva neste aparelho.
function temaAtual() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
function trocarTema() {
  const novo = temaAtual() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = novo;
  salvar("tema", novo);
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-tema]")) trocarTema();
});
// Se a página não tem o header (que traz o botão ☀️/🌙), coloca um botão flutuante no canto
document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("[data-tema]")) return;
  document.body.insertAdjacentHTML("beforeend",
    `<button class="btn-tema tema-flutuante" data-tema type="button" aria-label="Alternar modo claro e escuro"><span class="sol">☀️</span><span class="lua">🌙</span></button>`);
});

// ===== Regras da agenda =====
function lojaAbertaNoDia(d) {
  if ((FUNCIONAMENTO.datasFechadas || []).some((x) => x.data === chaveDia(d))) return false;
  return !!FUNCIONAMENTO.semana[d.getDay()]?.aberto;
}

function barbeiroTrabalha(b, d) {
  return !(b.folga || []).includes(d.getDay());
}

function ocupadoEm(lista, barbeiroId, dia, inicio, duracao, ignorarId) {
  return lista.some((a) => {
    if ((ignorarId != null && a.id === ignorarId) || a.status === "cancelado" || a.barbeiroId !== barbeiroId || a.dia !== dia) return false;
    const ai = paraMin(a.hora);
    return inicio < ai + a.duracao && ai < inicio + duracao;
  });
}

// Lista de horários do dia com a informação se está livre
function gradeHorarios(lista, barbeiroId, diaIso, duracao, ignorarId) {
  const cfg = FUNCIONAMENTO.semana[dataDe(diaIso).getDay()];
  const agora = new Date();
  const ehHoje = diaIso === chaveDia(agora);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const out = [];
  for (let m = paraMin(cfg.abre); m + duracao <= paraMin(cfg.fecha); m += Number(FUNCIONAMENTO.intervalo)) {
    out.push({
      hora: paraHora(m),
      livre: !(ehHoje && m <= minAgora) && !ocupadoEm(lista, barbeiroId, diaIso, m, duracao, ignorarId),
    });
  }
  return out;
}

// Estoque descontando o que já está reservado em agendamentos ainda não atendidos
function estoqueDisponivel(produto, lista) {
  const reservado = lista
    .filter((a) => a.status === "confirmado")
    .reduce((s, a) => s + (a.produtos || []).filter((p) => p.id === produto.id).reduce((x, p) => x + p.qtd, 0), 0);
  return Math.max(0, produto.estoque - reservado);
}

// Situação do agendamento vista pelo cliente
function statusDe(a) {
  if (a.status === "cancelado") return "cancelado";
  if (a.status === "atendido") return "concluido";
  if (a.status === "faltou") return "faltou";
  const fim = new Date(`${a.dia}T${a.hora}`);
  fim.setMinutes(fim.getMinutes() + a.duracao);
  return fim < new Date() ? "concluido" : "agendado";
}

// ===== "Ver mais": listas longas mostram só os primeiros itens =====
// Uso:  const h = verMais("historico", listaDeHtml, 5);
//       el.innerHTML = h.itens + h.botao;      (em tabelas: <table>${h.itens}</table>${h.botao})
// Os itens a mais ficam escondidos; o botão mostra/esconde sem redesenhar a tela.
// A escolha fica guardada enquanto a página estiver aberta.
const _verMaisAbertos = new Set();
function verMais(chave, itens, limite = 5) {
  const aberto = _verMaisAbertos.has(chave);
  const marcados = itens.map((html, i) => i < limite ? html
    : html.replace(/^(\s*<[a-zA-Z]+)/, `$1 data-vm="${chave}"${aberto ? "" : " hidden"}`));
  const resto = itens.length - limite;
  const botao = resto > 0
    ? `<button type="button" class="btn-ver-mais" data-ver-mais="${chave}" data-resto="${resto}" aria-expanded="${aberto}">${aberto ? "Ver menos ▲" : `Ver mais (${resto}) ▼`}</button>`
    : "";
  return { itens: marcados.join(""), botao };
}
// Atalho para listas que não são tabela: devolve os itens e o botão juntos
const juntarVerMais = (chave, itens, limite = 5) => { const v = verMais(chave, itens, limite); return v.itens + v.botao; };

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ver-mais]");
  if (!b) return;
  const chave = b.dataset.verMais;
  const abrir = !_verMaisAbertos.has(chave);
  if (abrir) _verMaisAbertos.add(chave); else _verMaisAbertos.delete(chave);
  document.querySelectorAll(`[data-vm="${chave}"]`).forEach((el) => (el.hidden = !abrir));
  b.textContent = abrir ? "Ver menos ▲" : `Ver mais (${b.dataset.resto}) ▼`;
  b.setAttribute("aria-expanded", String(abrir));
});
