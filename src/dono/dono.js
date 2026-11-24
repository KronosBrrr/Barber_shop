// =====================================================================
//  PAINEL DO DONO — núcleo: dados, login, janela (modal) e menu.
//  Cada aba do menu fica num arquivo em src/dono/abas/ (painel, agenda, barbeiros...).
//  Todos os dados vêm do banco de dados, pelo servidor (servidor/servidor.py).
// =====================================================================

// ================= Dados =================
let tokenDono = null;
try { tokenDono = sessionStorage.getItem("tokenDono"); } catch {}
let agendamentos = [];
let usuarios = [];
let pagamentos = [];
let despesas = [];
let OPCOES = {};
let DONO = {};        // nome, usuário, e-mail e WhatsApp do dono
let MENSAGENS = {};   // como os códigos de recuperação são enviados      // listas dos formulários (formas de pagamento, categorias...), vêm do servidor

const apiDono = (metodo, caminho, corpo) => api(metodo, caminho, corpo, tokenDono);

async function recarregar() {
  const d = await apiDono("GET", "/api/dono/dados");
  aplicarConfig(d.config);
  agendamentos = d.agendamentos;
  usuarios = d.usuarios;
  pagamentos = d.pagamentos;
  despesas = d.despesas;
  OPCOES = d.opcoes;
  DONO = d.dono;
  MENSAGENS = d.mensagens;
}

function falhou(e) {
  if (e.status === 401) { sairDono(); avisar("Sua sessão expirou. Entre de novo."); }
  else avisar(e.message);
}

// Manda uma alteração para o servidor, recarrega os dados e redesenha a tela
async function enviar(metodo, caminho, corpo, mensagem) {
  let ok = false;
  try {
    const r = await apiDono(metodo, caminho, corpo);
    ok = true;
    const extra = r && r.mensagem ? r.mensagem : "";   // ex.: resultado do reembolso
    if (mensagem || extra) avisar([mensagem, extra].filter(Boolean).join(" "));
  } catch (e) { falhou(e); }
  if (tokenDono) {
    try { await recarregar(); } catch {}
    if (!$("telaDono").hidden) renderAba();
  }
  return ok;
}

const salvarConfig = () => enviar("PUT", "/api/dono/config", {
  servicos: CONFIG.servicos, barbeiros: CONFIG.barbeiros, produtos: CONFIG.produtos, funcionamento: CONFIG.funcionamento,
  pagamentos: { chavePix: CONFIG.pagamentos.chavePix || "", recebedor: CONFIG.pagamentos.recebedor || "", cidade: CONFIG.pagamentos.cidade || "",
    maxParcelas: CONFIG.pagamentos.maxParcelas || 1 },
});

// Situação do pagamento de um agendamento, para mostrar na agenda
function seloPagamento(a) {
  if (a.reembolsoPendente) return `<span class="pg devolver">⚠ reembolso pendente (${esc(a.pagamento)})</span>`;
  if (a.status !== "confirmado" && a.pagamentoDetalhe === "valor reembolsado") return `<span class="pg na_barbearia">↩ reembolsado</span>`;
  if (a.status !== "confirmado") return "";
  return {
    pago: `<span class="pg pago">✓ Pago${a.pagamentoDetalhe ? ` · ${esc(a.pagamentoDetalhe)}` : ""}</span>`,
    pix_aguardando: `<span class="pg pix_aguardando">⚡ Pix aguardando confirmação</span>`,
    pendente: `<span class="pg pendente">Pagamento pendente</span>`,
    na_barbearia: `<span class="pg na_barbearia">Paga na barbearia</span>`,
  }[a.pagamentoStatus] || "";
}

// ================= Utilitários =================
const mesAtual = () => hojeIso().slice(0, 7);
const r2 = (v) => Math.round(v * 100) / 100;
const novoId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const agPorId = (id) => agendamentos.find((a) => String(a.id) === String(id));
const barbeiro = (id) => CONFIG.barbeiros.find((b) => b.id === id);
const ativos = (lista) => lista.filter((x) => x.ativo !== false);
const nomeMes = (m) => dataDe(m + "-01").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
function mesAnterior(m) {
  const [y, mm] = m.split("-").map(Number);
  return chaveDia(new Date(y, mm - 2, 1)).slice(0, 7);
}

// Agendamento cujo horário já passou e ninguém marcou se foi atendido
function pendente(a) {
  if (a.status !== "confirmado") return false;
  const fim = new Date(`${a.dia}T${a.hora}`);
  fim.setMinutes(fim.getMinutes() + a.duracao);
  return fim < new Date();
}

// Agendamento em aberto que caiu em dia fechado / fora do horário / folga do barbeiro
function foraDoHorario(a) {
  if (a.status !== "confirmado") return false;
  const d = dataDe(a.dia);
  if (!lojaAbertaNoDia(d)) return true;
  const b = barbeiro(a.barbeiroId);
  if (b && !barbeiroTrabalha(b, d)) return true;
  const cfg = CONFIG.funcionamento.semana[d.getDay()];
  return paraMin(a.hora) < paraMin(cfg.abre) || paraMin(a.hora) + a.duracao > paraMin(cfg.fecha);
}

// ================= Dinheiro =================
const totalProd = (a) => soma(a.produtos || [], (p) => p.preco * p.qtd);
const totalAg = (a) => a.total ?? a.preco + totalProd(a);
const custoProd = (a) =>
  soma(a.produtos || [], (p) => (p.custo ?? CONFIG.produtos.find((x) => x.id === p.id)?.custo ?? 0) * p.qtd);

function calcComissao(a, b) {
  return r2((a.preco * (b.comissao || 0)) / 100 + (totalProd(a) * (b.comissaoProdutos || 0)) / 100);
}
function comissaoDe(a) {
  if (a.status !== "atendido") return 0;
  if (a.comissaoValor != null) return a.comissaoValor;
  const b = barbeiro(a.barbeiroId);
  return b ? calcComissao(a, b) : 0;
}
const ganhoTotal = (id) => soma(agendamentos.filter((a) => a.barbeiroId === id), comissaoDe);
const pagoTotal = (id) => soma(pagamentos.filter((p) => p.barbeiroId === id), (p) => p.valor);
// Atendimentos já feitos cuja comissão ainda não foi paga ao barbeiro
const aReceber = (id) => agendamentos
  .filter((a) => a.barbeiroId === id && a.status === "atendido" && !a.repasseId && comissaoDe(a) > 0)
  .sort(porHora);
const saldoBarbeiro = (id) => r2(soma(aReceber(id), comissaoDe));

function resumo(mes) {
  const at = agendamentos.filter((a) => a.status === "atendido" && a.dia.startsWith(mes));
  const servicos = soma(at, (a) => a.preco);
  const produtos = soma(at, totalProd);
  const custo = soma(at, custoProd);
  const comissoes = soma(at, comissaoDe);
  const desp = soma(despesas.filter((d) => d.data.startsWith(mes)), (d) => d.valor);
  const receita = servicos + produtos;
  return { at, servicos, produtos, receita, custo, comissoes, desp, lucro: receita - custo - comissoes - desp, ticket: at.length ? receita / at.length : 0 };
}

function variacao(atual, anterior) {
  if (!anterior) return "";
  const p = ((atual - anterior) / Math.abs(anterior)) * 100;
  return `<small>${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(0)}% vs. mês anterior</small>`;
}

// ================= Login =================
$("formDono").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("erroDono").textContent = "";
  const botao = $("formDono").querySelector("button[type=submit]");
  botao.disabled = true;
  try {
    const r = await api("POST", "/api/dono/login", { usuario: $("usuarioDono").value, senha: $("senhaDono").value });
    tokenDono = r.token;
    try { sessionStorage.setItem("tokenDono", tokenDono); } catch {}
    $("senhaDono").value = "";
    await abrirPainel();
  } catch (er) {
    $("erroDono").textContent = er.message;
  } finally {
    botao.disabled = false;
  }
});
// Criou senha nova pelo "esqueci minha senha": todos os aparelhos saem da conta
document.addEventListener("barbearia:senha-recuperada", () => { if (tokenDono) sairDono(); });

function sairDono() {
  if (tokenDono) api("POST", "/api/logout", {}, tokenDono).catch(() => {});
  tokenDono = null;
  try { sessionStorage.removeItem("tokenDono"); } catch {}
  fecharModal();
  mostrarTela("telaLoginDono");
}
$("sairDono").addEventListener("click", sairDono);
async function abrirPainel() { await recarregar(); mostrarTela("telaDono"); renderAba(); }

// ================= Janela (modal) =================
let aoConfirmar = null;
function abrirModal({ titulo, corpo, ok = "Salvar", cancelar = true, aoSalvar }) {
  $("modalTitulo").textContent = titulo;
  $("modalCorpo").innerHTML = corpo;
  $("modalOk").textContent = ok;
  $("modalCancelar").hidden = !cancelar;
  aoConfirmar = aoSalvar || null;
  $("modal").hidden = false;
  $("modalCorpo").querySelector("input:not([type=hidden]), select, textarea")?.focus();
}
function fecharModal() { $("modal").hidden = true; aoConfirmar = null; }
$("modalForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const fn = aoConfirmar;
  const r = fn ? fn(new FormData($("modalForm"))) : undefined;
  // se a função abriu outra janela, não fecha
  if (r !== false && aoConfirmar === fn) fecharModal();
});
$("modalFechar").addEventListener("click", fecharModal);
$("modalCancelar").addEventListener("click", fecharModal);
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) fecharModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) fecharModal(); });

// ================= Navegação =================
const ABAS = {
  painel:     ["📊", "Painel",              () => renderPainel()],
  agenda:     ["📅", "Agenda",              () => renderAgenda()],
  barbeiros:  ["💈", "Barbeiros",           () => renderBarbeiros()],
  financeiro: ["💰", "Financeiro",          () => renderFinanceiro()],
  horarios:   ["🕘", "Funcionamento",       () => renderHorarios()],
  catalogo:   ["🧴", "Serviços e produtos", () => renderCatalogo()],
  clientes:   ["👥", "Clientes",            () => renderClientes()],
  site:       ["🏠", "Página inicial",      () => renderSite()],
  config:     ["⚙️", "Configurações",       () => renderConfigDono()],
};
let abaAtual = "painel";

function renderAba() {
  const nPend = agendamentos.filter(pendente).length;
  $("nav").innerHTML = Object.entries(ABAS).map(([k, [ic, nome]]) =>
    `<button class="nav-item ${k === abaAtual ? "ativo" : ""}" data-aba="${k}">
      <span>${ic}</span>${nome}${k === "agenda" && nPend ? `<span class="badge">${nPend}</span>` : ""}
    </button>`).join("");
  ABAS[abaAtual][2]();
}
$("nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-aba]");
  if (!b) return;
  abaAtual = b.dataset.aba;
  renderAba();
  window.scrollTo(0, 0);
});

// Ações dos botões (data-acao), mudanças em campos (data-mudar) e digitação (data-digitar)
const ACOES = {}, MUDAR = {}, DIGITAR = {};
function tratarClique(e) {
  const b = e.target.closest("[data-acao]");
  if (b && ACOES[b.dataset.acao]) { e.preventDefault(); ACOES[b.dataset.acao](b.dataset.id, b); }
}
$("conteudo").addEventListener("click", tratarClique);
$("modalCorpo").addEventListener("click", tratarClique);
$("conteudo").addEventListener("change", (e) => { const el = e.target.closest("[data-mudar]"); if (el) MUDAR[el.dataset.mudar]?.(el); });
$("conteudo").addEventListener("input", (e) => { const el = e.target.closest("[data-digitar]"); if (el) DIGITAR[el.dataset.digitar]?.(el); });

// A cada 30 segundos busca novidades (ex.: um cliente acabou de agendar)
setInterval(async () => {
  if (!tokenDono || $("telaDono").hidden || !$("modal").hidden || !["painel", "agenda"].includes(abaAtual)) return;
  try { await recarregar(); renderAba(); } catch (e) { if (e.status === 401) falhou(e); }
}, 30000);

// ================= Componentes =================
const ROTULO = { confirmado: "Agendado", atendido: "Atendido", faltou: "Faltou", cancelado: "Cancelado" };

function linhaAg(a, comData) {
  const acoes = a.status === "confirmado"
    ? `${a.pagamentoStatus === "pix_aguardando" ? `<button class="btn-peq ouro" data-acao="confirmarPix" data-id="${a.id}">⚡ Pix recebido</button>` : ""}
       <button class="btn-peq verde" data-acao="atender" data-id="${a.id}">✓ Atendido</button>
       <button class="btn-peq" data-acao="transferir" data-id="${a.id}">Trocar barbeiro</button>
       <button class="btn-peq vermelho" data-acao="faltou" data-id="${a.id}">Faltou</button>
       <button class="btn-peq vermelho" data-acao="cancelarAg" data-id="${a.id}">Cancelar</button>`
    : `${a.reembolsoPendente ? `<button class="btn-peq ouro" data-acao="reembolsar" data-id="${a.id}">💸 Reembolsar</button>` : ""}
       <span class="status ${a.status}">${ROTULO[a.status] || esc(a.status)}</span>`;
  return `
  <div class="ag-linha st-${a.status}">
    <div class="ag-hora">${a.hora}${comData ? `<small>${dataCurta(a.dia)}</small>` : ""}</div>
    <div class="ag-info">
      <div><strong>${esc(a.cliente)}</strong> <span class="sub">· ${esc(a.servico)} com ${esc(a.barbeiro)}</span></div>
      ${chipsProdutos(a)}
      ${a.obs ? `<p class="sub">📝 ${esc(a.obs)}</p>` : ""}
      <p class="sub">${seloPagamento(a)} ${esc(a.pagamento || "—")} · ${real(totalAg(a))}${a.telefone ? ` · ${linkZap(a.telefone)}` : ""}${a.origem === "balcao" ? " · balcão" : ""}${foraDoHorario(a) ? ` · <span style="color:var(--perigo)">⚠ fora do horário</span>` : ""}</p>
    </div>
    <div class="ag-acoes">${acoes}</div>
  </div>`;
}

// ================= Início =================
// Espera todos os arquivos das abas carregarem (eles vêm depois deste no dono.html)
document.addEventListener("DOMContentLoaded", () => {
  mostrarTela("telaLoginDono");
  if (!tokenDono) return;
  abrirPainel().catch((e) => {
    tokenDono = null;
    try { sessionStorage.removeItem("tokenDono"); } catch {}
    if (e.status !== 401) avisar(e.message);
  });
});
