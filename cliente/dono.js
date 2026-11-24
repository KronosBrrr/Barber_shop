// =====================================================================
//  PAINEL DO DONO
//  Todos os dados vêm do banco de dados, pelo servidor (servidor/servidor.py).
// =====================================================================

// ================= Dados =================
let tokenDono = null;
try { tokenDono = sessionStorage.getItem("tokenDono"); } catch {}
let agendamentos = [];
let usuarios = [];
let pagamentos = [];
let despesas = [];

const apiDono = (metodo, caminho, corpo) => api(metodo, caminho, corpo, tokenDono);

async function recarregar() {
  const d = await apiDono("GET", "/api/dono/dados");
  aplicarConfig(d.config);
  agendamentos = d.agendamentos;
  usuarios = d.usuarios;
  pagamentos = d.pagamentos;
  despesas = d.despesas;
}

function falhou(e) {
  if (e.status === 401) { sairDono(); avisar("Sua sessão expirou. Entre de novo."); }
  else avisar(e.message);
}

// Manda uma alteração para o servidor, recarrega os dados e redesenha a tela
async function enviar(metodo, caminho, corpo, mensagem) {
  let ok = false;
  try {
    await apiDono(metodo, caminho, corpo);
    ok = true;
    if (mensagem) avisar(mensagem);
  } catch (e) { falhou(e); }
  if (tokenDono) {
    try { await recarregar(); } catch {}
    if (!$("telaDono").hidden) renderAba();
  }
  return ok;
}

const salvarConfig = () => enviar("PUT", "/api/dono/config", {
  servicos: CONFIG.servicos, barbeiros: CONFIG.barbeiros, produtos: CONFIG.produtos, funcionamento: CONFIG.funcionamento,
});

// ================= Utilitários =================
const hojeIso = () => chaveDia(new Date());
const mesAtual = () => hojeIso().slice(0, 7);
const r2 = (v) => Math.round(v * 100) / 100;
const soma = (lista, f) => lista.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const novoId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const porHora = (a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora);
const agPorId = (id) => agendamentos.find((a) => String(a.id) === String(id));
const barbeiro = (id) => CONFIG.barbeiros.find((b) => b.id === id);
const ativos = (lista) => lista.filter((x) => x.ativo !== false);
const nomeMes = (m) => dataDe(m + "-01").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
function mesAnterior(m) {
  const [y, mm] = m.split("-").map(Number);
  return chaveDia(new Date(y, mm - 2, 1)).slice(0, 7);
}
function fmtTel(t) {
  const d = soDigitos(t);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || "—";
}
const linkZap = (t, texto = "WhatsApp") =>
  soDigitos(t).length >= 10 ? `<a href="https://wa.me/55${soDigitos(t)}" target="_blank" rel="noopener">${texto}</a>` : "";

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
const saldoBarbeiro = (id) => r2(ganhoTotal(id) - pagoTotal(id));

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

function chipsProdutos(a) {
  if (!a.produtos?.length) return "";
  return `<div class="chips">${a.produtos.map((p) => `<span class="chip">📦 ${esc(p.nome)} ×${p.qtd}</span>`).join("")}</div>`;
}

function linhaAg(a, comData) {
  const acoes = a.status === "confirmado"
    ? `<button class="btn-peq verde" data-acao="atender" data-id="${a.id}">✓ Atendido</button>
       <button class="btn-peq" data-acao="transferir" data-id="${a.id}">Trocar barbeiro</button>
       <button class="btn-peq vermelho" data-acao="faltou" data-id="${a.id}">Faltou</button>
       <button class="btn-peq vermelho" data-acao="cancelarAg" data-id="${a.id}">Cancelar</button>`
    : `<span class="status ${a.status}">${ROTULO[a.status] || esc(a.status)}</span>`;
  return `
  <div class="ag-linha st-${a.status}">
    <div class="ag-hora">${a.hora}${comData ? `<small>${dataCurta(a.dia)}</small>` : ""}</div>
    <div class="ag-info">
      <div><strong>${esc(a.cliente)}</strong> <span class="sub">· ${esc(a.servico)} com ${esc(a.barbeiro)}</span></div>
      ${chipsProdutos(a)}
      ${a.obs ? `<p class="sub">📝 ${esc(a.obs)}</p>` : ""}
      <p class="sub">${esc(a.pagamento || "—")} · ${real(totalAg(a))}${a.telefone ? ` · ${linkZap(a.telefone)}` : ""}${a.origem === "balcao" ? " · balcão" : ""}${foraDoHorario(a) ? ` · <span style="color:var(--perigo)">⚠ fora do horário</span>` : ""}</p>
    </div>
    <div class="ag-acoes">${acoes}</div>
  </div>`;
}

const vazio = (txt) => `<p class="sub" style="padding:12px 0">${txt}</p>`;

// =====================================================================
//  PAINEL
// =====================================================================
function renderPainel() {
  const hoje = hojeIso();
  const r = resumo(mesAtual());
  const rAnt = resumo(mesAnterior(mesAtual()));
  const agHoje = agendamentos.filter((a) => a.dia === hoje && a.status !== "cancelado").sort(porHora);
  const atendidosHoje = agHoje.filter((a) => a.status === "atendido");
  const restantes = agHoje.filter((a) => a.status === "confirmado");
  const aPagar = soma(CONFIG.barbeiros, (b) => Math.max(0, saldoBarbeiro(b.id)));
  const pend = agendamentos.filter(pendente);
  const fora = agendamentos.filter((a) => a.dia >= hoje && foraDoHorario(a));
  const separar = restantes.filter((a) => a.produtos?.length);
  const baixo = ativos(CONFIG.produtos).filter((p) => estoqueDisponivel(p, agendamentos) <= 3);
  const cfgHoje = CONFIG.funcionamento.semana[new Date().getDay()];

  $("conteudo").innerHTML = `
    <div class="cab">
      <div>
        <h1>Bom dia de trabalho! 💈</h1>
        <p class="sub">${dataBonita(hoje)} · ${lojaAbertaNoDia(new Date()) ? `aberto das ${cfgHoje.abre} às ${cfgHoje.fecha}` : "barbearia fechada hoje"}</p>
      </div>
      <div class="acoes"><button class="btn-peq ouro" data-acao="novoAg">+ Agendamento no balcão</button></div>
    </div>

    ${pend.length ? `<div class="alerta"><span>⏳ <strong>${pend.length}</strong> atendimento(s) já passaram e ainda não foram marcados como atendido ou falta.</span><button class="btn-peq ouro" data-acao="verPendentes">Resolver</button></div>` : ""}
    ${fora.length ? `<div class="alerta vermelho"><span>⚠ <strong>${fora.length}</strong> agendamento(s) caem em dia fechado, folga do barbeiro ou fora do horário. Troque o barbeiro ou avise o cliente.</span><button class="btn-peq" data-acao="verFora">Ver</button></div>` : ""}
    ${baixo.length ? `<div class="alerta"><span>📦 Estoque baixo: ${baixo.map((p) => `<strong>${esc(p.nome)}</strong> (${estoqueDisponivel(p, agendamentos)})`).join(", ")}</span><button class="btn-peq" data-acao="irCatalogo">Repor</button></div>` : ""}

    <div class="indicadores">
      <div class="ind"><span>Atendimentos hoje</span><strong>${atendidosHoje.length} / ${agHoje.filter((a) => a.status !== "faltou").length}</strong><small>${restantes.length} ainda por atender</small></div>
      <div class="ind"><span>Faturado hoje</span><strong>${real(soma(atendidosHoje, totalAg))}</strong><small>previsto ${real(soma(agHoje.filter((a) => a.status !== "faltou"), totalAg))}</small></div>
      <div class="ind"><span>Faturado no mês</span><strong>${real(r.receita)}</strong>${variacao(r.receita, rAnt.receita)}</div>
      <div class="ind destaque ${r.lucro >= 0 ? "positivo" : "negativo"}"><span>Lucro do mês</span><strong>${real(r.lucro)}</strong>${variacao(r.lucro, rAnt.lucro)}</div>
      <div class="ind"><span>A pagar aos barbeiros</span><strong>${real(aPagar)}</strong><small><button class="link" data-acao="irBarbeiros">ver barbeiros</button></small></div>
    </div>

    <div class="colunas">
      <div class="bloco">
        <h2>Agenda de hoje <button class="btn-peq" data-acao="irAgenda">Ver agenda</button></h2>
        ${agHoje.length ? agHoje.map((a) => linhaAg(a)).join("") : vazio("Nenhum agendamento para hoje.")}
      </div>
      <div>
        <div class="bloco">
          <h2>🎁 Produtos para separar hoje</h2>
          ${separar.length ? separar.map((a) => `
            <div class="ag-linha">
              <div class="ag-hora">${a.hora}</div>
              <div class="ag-info"><strong>${esc(a.cliente)}</strong>${chipsProdutos(a)}</div>
            </div>`).join("") : vazio("Nenhum produto para entregar hoje.")}
        </div>
        <div class="bloco">
          <h2>Barbeiros hoje</h2>
          ${ativos(CONFIG.barbeiros).map((b) => {
            const folga = !barbeiroTrabalha(b, new Date());
            const n = agHoje.filter((a) => a.barbeiroId === b.id && a.status !== "faltou").length;
            return `<div class="ag-linha"><span class="avatar">${esc(b.nome[0])}</span>
              <div class="ag-info"><strong>${esc(b.nome)}</strong><span class="sub">${folga ? "De folga hoje" : `${n} atendimento(s) hoje`}</span></div></div>`;
          }).join("") || vazio("Nenhum barbeiro cadastrado.")}
        </div>
      </div>
    </div>`;
}

ACOES.irAgenda = () => { fAg = { dia: hojeIso(), barbeiro: "todos", status: "todos" }; abaAtual = "agenda"; renderAba(); };
ACOES.irBarbeiros = () => { abaAtual = "barbeiros"; renderAba(); };
ACOES.irCatalogo = () => { abaAtual = "catalogo"; renderAba(); };
ACOES.verPendentes = () => { fAg = { dia: "", barbeiro: "todos", status: "pendente" }; abaAtual = "agenda"; renderAba(); };
ACOES.verFora = () => { fAg = { dia: "", barbeiro: "todos", status: "fora" }; abaAtual = "agenda"; renderAba(); };

// =====================================================================
//  AGENDA
// =====================================================================
let fAg = { dia: hojeIso(), barbeiro: "todos", status: "todos" };

function renderAgenda() {
  let lista = agendamentos.slice();
  if (fAg.status === "pendente") lista = lista.filter(pendente);
  else if (fAg.status === "fora") lista = lista.filter((a) => a.dia >= hojeIso() && foraDoHorario(a));
  else {
    if (fAg.dia) lista = lista.filter((a) => a.dia === fAg.dia);
    else lista = lista.filter((a) => a.dia >= hojeIso());
    if (fAg.status !== "todos") lista = lista.filter((a) => a.status === fAg.status);
  }
  if (fAg.barbeiro !== "todos") lista = lista.filter((a) => a.barbeiroId === fAg.barbeiro);
  lista.sort(porHora);

  const comData = !fAg.dia || ["pendente", "fora"].includes(fAg.status);
  const validos = lista.filter((a) => a.status !== "cancelado" && a.status !== "faltou");
  let titulo = "Próximos agendamentos";
  if (fAg.status === "pendente") titulo = "Atendimentos pendentes de confirmação";
  else if (fAg.status === "fora") titulo = "Agendamentos fora do horário";
  else if (fAg.dia) {
    const d = dataDe(fAg.dia), c = CONFIG.funcionamento.semana[d.getDay()];
    titulo = `${dataBonita(fAg.dia)} <span class="sub">· ${lojaAbertaNoDia(d) ? `${c.abre}–${c.fecha}` : "fechado"}</span>`;
  }

  $("conteudo").innerHTML = `
    <div class="cab">
      <h1>Agenda</h1>
      <div class="acoes"><button class="btn-peq ouro" data-acao="novoAg">+ Novo agendamento</button></div>
    </div>

    <div class="filtros-ag">
      <button class="btn-peq" data-acao="diaAnt" aria-label="Dia anterior">‹</button>
      <input type="date" value="${fAg.dia}" data-mudar="agDia">
      <button class="btn-peq" data-acao="diaProx" aria-label="Próximo dia">›</button>
      <button class="btn-peq" data-acao="agHoje">Hoje</button>
      <button class="btn-peq ${!fAg.dia && fAg.status === "todos" ? "ouro" : ""}" data-acao="agTodas">Todos os próximos</button>
      <select data-mudar="agBarb">
        <option value="todos">Todos os barbeiros</option>
        ${CONFIG.barbeiros.map((b) => `<option value="${b.id}" ${fAg.barbeiro === b.id ? "selected" : ""}>${esc(b.nome)}${b.ativo === false ? " (desligado)" : ""}</option>`).join("")}
      </select>
      <select data-mudar="agStatus">
        ${[["todos", "Todas as situações"], ["confirmado", "Agendados"], ["atendido", "Atendidos"], ["faltou", "Faltas"], ["cancelado", "Cancelados"], ["pendente", "⏳ Pendentes"], ["fora", "⚠ Fora do horário"]]
          .map(([v, t]) => `<option value="${v}" ${fAg.status === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>

    <div class="bloco">
      <h2><span>${titulo}</span><span class="sub">${validos.length} atendimento(s) · ${real(soma(validos, totalAg))}</span></h2>
      ${lista.length ? lista.map((a) => linhaAg(a, comData)).join("") : vazio("Nada por aqui.")}
    </div>`;
}

function moverDia(delta) {
  const d = dataDe(fAg.dia || hojeIso());
  d.setDate(d.getDate() + delta);
  fAg.dia = chaveDia(d);
  if (["pendente", "fora"].includes(fAg.status)) fAg.status = "todos";
  renderAgenda();
}
ACOES.diaAnt = () => moverDia(-1);
ACOES.diaProx = () => moverDia(1);
ACOES.agHoje = () => { fAg.dia = hojeIso(); if (["pendente", "fora"].includes(fAg.status)) fAg.status = "todos"; renderAgenda(); };
ACOES.agTodas = () => { fAg.dia = ""; fAg.status = "todos"; renderAgenda(); };
MUDAR.agDia = (el) => { fAg.dia = el.value; if (["pendente", "fora"].includes(fAg.status)) fAg.status = "todos"; renderAgenda(); };
MUDAR.agBarb = (el) => { fAg.barbeiro = el.value; renderAgenda(); };
MUDAR.agStatus = (el) => { fAg.status = el.value; renderAgenda(); };

// ---- Marcar como atendido (e receber o pagamento)
ACOES.atender = (id) => {
  const a = agPorId(id), b = barbeiro(a.barbeiroId);
  const jaPago = a.pagamento && a.pagamento !== "Pagar na barbearia";
  const comissao = b ? calcComissao(a, b) : 0;
  abrirModal({
    titulo: "Confirmar atendimento",
    ok: "Confirmar atendido",
    corpo: `
      <div class="info-caixa">
        <strong>${esc(a.cliente)}</strong>
        <span>${esc(a.servico)} com ${esc(a.barbeiro)} · ${dataCurta(a.dia)} às ${a.hora}</span>
        ${chipsProdutos(a)}
        <span>Total: <strong>${real(totalAg(a))}</strong></span>
        <span class="sub">Comissão de ${esc(a.barbeiro)}: ${real(comissao)}</span>
      </div>
      ${jaPago
        ? `<p class="sub">✓ Cliente escolheu pagar pelo app (${esc(a.pagamento)}).</p>`
        : `<label>Como o cliente pagou?
             <select name="forma" required>
               ${["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito"].map((f) => `<option>${f}</option>`).join("")}
             </select>
           </label>`}
      ${a.produtos?.length ? `<p class="sub">📦 Os produtos entregues serão descontados do estoque.</p>` : ""}`,
    aoSalvar: (fd) => {
      enviar("POST", `/api/dono/agendamentos/${a.id}/atender`, { forma: fd.get("forma") }, `Atendimento de ${a.cliente} confirmado.`);
    },
  });
};

ACOES.faltou = (id) => {
  const a = agPorId(id);
  if (!confirm(`Marcar que ${a.cliente} não compareceu?`)) return;
  enviar("POST", `/api/dono/agendamentos/${a.id}/status`, { status: "faltou" }, "Falta registrada.");
};
ACOES.cancelarAg = (id) => {
  const a = agPorId(id);
  if (!confirm(`Cancelar o agendamento de ${a.cliente} (${dataCurta(a.dia)} às ${a.hora})?`)) return;
  enviar("POST", `/api/dono/agendamentos/${a.id}/status`, { status: "cancelado" }, "Agendamento cancelado. Lembre de avisar o cliente.");
};

// ---- Trocar o barbeiro de um agendamento
ACOES.transferir = (id) => {
  const a = agPorId(id), d = dataDe(a.dia);
  const livres = ativos(CONFIG.barbeiros).filter((b) =>
    b.id !== a.barbeiroId && barbeiroTrabalha(b, d) && !ocupadoEm(agendamentos, b.id, a.dia, paraMin(a.hora), a.duracao, a.id));
  if (!livres.length) {
    abrirModal({ titulo: "Trocar barbeiro", cancelar: false, ok: "Fechar",
      corpo: `<p>Nenhum outro barbeiro está livre em ${dataCurta(a.dia)} às ${a.hora}.</p><p class="sub">Combine outro horário com o cliente${a.telefone ? ` (${linkZap(a.telefone)})` : ""} ou cancele o agendamento.</p>` });
    return;
  }
  abrirModal({
    titulo: "Trocar barbeiro",
    corpo: `
      <p class="sub">${esc(a.cliente)} · ${esc(a.servico)} · ${dataCurta(a.dia)} às ${a.hora} (hoje com ${esc(a.barbeiro)})</p>
      <label>Novo barbeiro
        <select name="barbeiro">${livres.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join("")}</select>
      </label>`,
    aoSalvar: (fd) => {
      const b = barbeiro(fd.get("barbeiro"));
      enviar("POST", `/api/dono/agendamentos/${a.id}/transferir`, { barbeiroId: b.id }, `Transferido para ${b.nome}. Avise o cliente.`);
    },
  });
};

// ---- Agendamento feito pelo dono (cliente no balcão ou por telefone)
ACOES.novoAg = () => {
  const servs = ativos(CONFIG.servicos), barbs = ativos(CONFIG.barbeiros);
  if (!servs.length || !barbs.length) { avisar("Cadastre pelo menos um serviço e um barbeiro."); return; }
  abrirModal({
    titulo: "Novo agendamento",
    ok: "Agendar",
    corpo: `
      <div class="dupla">
        <label>Nome do cliente<input name="nome" required></label>
        <label>WhatsApp<input name="tel" type="tel" placeholder="(00) 00000-0000"></label>
      </div>
      <div class="dupla">
        <label>Serviço<select name="servico" id="mServ">${servs.map((s) => `<option value="${s.id}">${esc(s.nome)} — ${real(s.preco)}</option>`).join("")}</select></label>
        <label>Barbeiro<select name="barbeiro" id="mBarb">${barbs.map((b) => `<option value="${b.id}" ${fAg.barbeiro === b.id ? "selected" : ""}>${esc(b.nome)}</option>`).join("")}</select></label>
      </div>
      <div class="dupla">
        <label>Dia<input type="date" name="dia" id="mDia" required value="${fAg.dia && fAg.dia >= hojeIso() ? fAg.dia : hojeIso()}" min="${hojeIso()}"></label>
        <label>Horário<select name="hora" id="mHora" required></select></label>
      </div>
      <label>Pagamento
        <select name="pagamento">${["Pagar na barbearia", "Pix", "Cartão de crédito", "Cartão de débito"].map((f) => `<option>${f}</option>`).join("")}</select>
      </label>
      <label>Observação<input name="obs"></label>`,
    aoSalvar: (fd) => {
      const b = barbeiro(fd.get("barbeiro"));
      const hora = fd.get("hora"), dia = fd.get("dia");
      if (!hora) { avisar("Escolha um horário livre."); return false; }
      enviar("POST", "/api/dono/agendamentos", {
        nome: fd.get("nome"), telefone: soDigitos(fd.get("tel")), servicoId: fd.get("servico"), barbeiroId: b.id,
        dia, hora, pagamento: fd.get("pagamento"), obs: fd.get("obs"),
      }, `Agendado: ${dataCurta(dia)} às ${hora} com ${b.nome}.`);
    },
  });
  const atualizar = () => {
    const s = CONFIG.servicos.find((x) => x.id === $("mServ").value), b = barbeiro($("mBarb").value);
    const dia = $("mDia").value, sel = $("mHora");
    if (!dia) { sel.innerHTML = `<option value="">Escolha o dia</option>`; return; }
    const d = dataDe(dia);
    if (!lojaAbertaNoDia(d)) sel.innerHTML = `<option value="">Barbearia fechada neste dia</option>`;
    else if (!barbeiroTrabalha(b, d)) sel.innerHTML = `<option value="">${esc(b.nome)} está de folga</option>`;
    else {
      const livres = gradeHorarios(agendamentos, b.id, dia, s.duracao).filter((x) => x.livre);
      sel.innerHTML = livres.length ? livres.map((x) => `<option>${x.hora}</option>`).join("") : `<option value="">Sem horários livres</option>`;
    }
  };
  ["mServ", "mBarb", "mDia"].forEach((id) => $(id).addEventListener("change", atualizar));
  atualizar();
};

// =====================================================================
//  BARBEIROS
// =====================================================================
function renderBarbeiros() {
  const mes = mesAtual();
  const lista = ativos(CONFIG.barbeiros);
  const desligados = CONFIG.barbeiros.filter((b) => b.ativo === false);

  $("conteudo").innerHTML = `
    <div class="cab">
      <h1>Barbeiros</h1>
      <div class="acoes"><button class="btn-peq ouro" data-acao="novoBarb">+ Adicionar barbeiro</button></div>
    </div>

    <div class="cards-barb">
      ${lista.map((b) => {
        const atMes = agendamentos.filter((a) => a.barbeiroId === b.id && a.status === "atendido" && a.dia.startsWith(mes));
        const saldo = saldoBarbeiro(b.id);
        const abertos = agendamentos.filter((a) => a.barbeiroId === b.id && a.status === "confirmado").length;
        return `
        <div class="card-barb">
          <div class="topo-b">
            <span class="avatar grande">${esc(b.nome[0])}</span>
            <div><h3>${esc(b.nome)}</h3><p class="sub">${esc(b.especialidade || "")}</p><p class="sub">${b.telefone ? `${fmtTel(b.telefone)} · ${linkZap(b.telefone)}` : ""}</p></div>
          </div>
          <div class="dados">
            <div><span>Comissão</span>${b.comissao}% serviços · ${b.comissaoProdutos || 0}% produtos</div>
            <div><span>Folga</span>${(b.folga || []).length ? b.folga.map((i) => DIAS_SEMANA[i].slice(0, 3)).join(", ") : "Nenhuma"}</div>
            <div><span>Atendimentos no mês</span>${atMes.length} · ${real(soma(atMes, totalAg))}</div>
            <div><span>Ganhou no mês</span>${real(soma(atMes, comissaoDe))}</div>
          </div>
          <div class="saldo ${saldo <= 0.009 ? "zerado" : ""}">
            <span>${saldo < -0.009 ? "Adiantado" : saldo > 0.009 ? "A pagar" : "Pagamento em dia"}</span>
            <strong>${real(Math.abs(saldo))}</strong>
          </div>
          <p class="sub">${abertos} agendamento(s) em aberto</p>
          <div class="botoes">
            <button class="btn-peq ouro" data-acao="pagar" data-id="${b.id}">💵 Pagar</button>
            <button class="btn-peq" data-acao="histPag" data-id="${b.id}">Pagamentos</button>
            <button class="btn-peq" data-acao="editarBarb" data-id="${b.id}">Editar</button>
            <button class="btn-peq vermelho" data-acao="removerBarb" data-id="${b.id}">Remover</button>
          </div>
        </div>`;
      }).join("") || vazio("Nenhum barbeiro ativo. Clique em “Adicionar barbeiro”.")}
    </div>

    ${desligados.length ? `
    <div class="bloco" style="margin-top:20px">
      <h2>Barbeiros desligados</h2>
      <div class="tabela-wrap"><table>
        <tr><th>Nome</th><th>Saiu em</th><th class="num">Saldo</th><th></th></tr>
        ${desligados.map((b) => `<tr>
          <td>${esc(b.nome)}</td><td>${b.desligadoEm ? dataCurta(b.desligadoEm) : "—"}</td>
          <td class="num">${real(saldoBarbeiro(b.id))}</td>
          <td class="num"><button class="btn-peq" data-acao="histPag" data-id="${b.id}">Pagamentos</button>
            <button class="btn-peq" data-acao="reativarBarb" data-id="${b.id}">Reativar</button></td></tr>`).join("")}
      </table></div>
    </div>` : ""}`;
}

function formBarbeiro(b = {}) {
  return `
    <label>Nome<input name="nome" required value="${esc(b.nome || "")}"></label>
    <div class="dupla">
      <label>WhatsApp<input name="telefone" type="tel" value="${esc(fmtTel(b.telefone) === "—" ? "" : fmtTel(b.telefone))}"></label>
      <label>Especialidade<input name="especialidade" value="${esc(b.especialidade || "")}" placeholder="Ex.: Degradê"></label>
    </div>
    <div class="dupla">
      <label>Comissão nos serviços (%)<input type="number" name="comissao" min="0" max="100" step="1" required value="${b.comissao ?? 50}"></label>
      <label>Comissão nos produtos (%)<input type="number" name="comissaoProdutos" min="0" max="100" step="1" required value="${b.comissaoProdutos ?? 10}"></label>
    </div>
    <div>
      <p class="sub" style="margin-bottom:6px">Dias de folga</p>
      <div class="dias-check">${DIAS_SEMANA.map((d, i) =>
        `<label><input type="checkbox" name="folga" value="${i}" ${(b.folga || []).includes(i) ? "checked" : ""}>${d.slice(0, 3)}</label>`).join("")}</div>
    </div>
    ${b.id ? `<p class="sub">Mudanças na comissão valem para os próximos atendimentos. Os já feitos continuam com o valor da época.</p>` : ""}`;
}

function lerFormBarbeiro(fd) {
  return {
    nome: fd.get("nome").trim(),
    telefone: soDigitos(fd.get("telefone")),
    especialidade: fd.get("especialidade").trim(),
    comissao: Number(fd.get("comissao")),
    comissaoProdutos: Number(fd.get("comissaoProdutos")),
    folga: fd.getAll("folga").map(Number),
  };
}

ACOES.novoBarb = () => abrirModal({
  titulo: "Adicionar barbeiro",
  ok: "Adicionar",
  corpo: formBarbeiro(),
  aoSalvar: (fd) => {
    const dados = lerFormBarbeiro(fd);
    CONFIG.barbeiros.push({ id: novoId("b"), ...dados, ativo: true, entrouEm: hojeIso() });
    salvarConfig(); avisar(`${dados.nome} foi adicionado. Já aparece para os clientes.`); renderAba();
  },
});

ACOES.editarBarb = (id) => {
  const b = barbeiro(id);
  abrirModal({
    titulo: `Editar ${b.nome}`,
    corpo: formBarbeiro(b),
    aoSalvar: (fd) => {
      Object.assign(b, lerFormBarbeiro(fd));
      salvarConfig();
      const conflito = agendamentos.filter((a) => a.barbeiroId === b.id && a.dia >= hojeIso() && foraDoHorario(a)).length;
      avisar(conflito ? `Salvo. Atenção: ${conflito} agendamento(s) caem na folga nova.` : "Barbeiro atualizado.");
      renderAba();
    },
  });
};

ACOES.removerBarb = (id) => {
  const b = barbeiro(id), saldo = saldoBarbeiro(id);
  const abertos = agendamentos.filter((a) => a.barbeiroId === id && a.status === "confirmado");

  if (saldo > 0.009) {
    abrirModal({
      titulo: "Ainda não dá para remover",
      ok: "Pagar agora",
      corpo: `<div class="alerta vermelho"><span>${esc(b.nome)} ainda tem <strong>${real(saldo)}</strong> a receber. Para tirar o barbeiro do sistema, faça o pagamento antes.</span></div>`,
      aoSalvar: () => ACOES.pagar(id),
    });
    return;
  }
  if (abertos.length) {
    abrirModal({
      titulo: "Ainda não dá para remover",
      ok: "Ver na agenda",
      corpo: `<div class="alerta vermelho"><span>${esc(b.nome)} tem <strong>${abertos.length}</strong> agendamento(s) em aberto. Troque o barbeiro, cancele ou marque como atendido antes de remover.</span></div>`,
      aoSalvar: () => { fAg = { dia: "", barbeiro: id, status: "confirmado" }; abaAtual = "agenda"; renderAba(); },
    });
    return;
  }
  abrirModal({
    titulo: `Remover ${b.nome}?`,
    ok: "Remover barbeiro",
    corpo: `
      <div class="info-caixa">
        <span>✓ Pagamentos em dia</span>
        <span>✓ Nenhum agendamento em aberto</span>
        ${saldo < -0.009 ? `<span style="color:var(--perigo)">⚠ Ele recebeu ${real(-saldo)} a mais (adiantamento).</span>` : ""}
      </div>
      <p class="sub">Ele deixa de aparecer para os clientes. O histórico de atendimentos e pagamentos continua guardado, e você pode reativá-lo depois.</p>`,
    aoSalvar: () => {
      enviar("POST", `/api/dono/barbeiros/${b.id}/remover`, {}, `${b.nome} foi removido do sistema.`);
    },
  });
};

ACOES.reativarBarb = (id) => {
  const b = barbeiro(id);
  enviar("POST", `/api/dono/barbeiros/${b.id}/reativar`, {}, `${b.nome} voltou para a equipe.`);
};

ACOES.pagar = (id) => {
  const b = barbeiro(id), saldo = saldoBarbeiro(id);
  abrirModal({
    titulo: `Pagar ${b.nome}`,
    ok: "Registrar pagamento",
    corpo: `
      <div class="info-caixa">
        <span>Total ganho em comissões: <strong>${real(ganhoTotal(id))}</strong></span>
        <span>Já pago: <strong>${real(pagoTotal(id))}</strong></span>
        <span>Saldo a pagar: <strong style="color:var(--destaque)">${real(Math.max(0, saldo))}</strong></span>
      </div>
      <div class="dupla">
        <label>Valor (R$)<input type="number" name="valor" min="0.01" step="0.01" required value="${saldo > 0 ? saldo.toFixed(2) : ""}"></label>
        <label>Data<input type="date" name="data" required value="${hojeIso()}"></label>
      </div>
      <label>Forma<select name="forma">${["Pix", "Dinheiro", "Transferência"].map((f) => `<option>${f}</option>`).join("")}</select></label>
      <label>Observação<input name="obs" placeholder="Ex.: comissões da semana"></label>
      <p class="sub">Pagar mais que o saldo fica registrado como adiantamento.</p>`,
    aoSalvar: (fd) => {
      const valor = r2(Number(fd.get("valor")));
      if (!(valor > 0)) { avisar("Digite um valor válido."); return false; }
      enviar("POST", "/api/dono/pagamentos", { barbeiroId: id, valor, data: fd.get("data"), forma: fd.get("forma"), obs: fd.get("obs") },
        `Pagamento de ${real(valor)} para ${b.nome} registrado.`);
    },
  });
};

ACOES.histPag = (id) => {
  const b = barbeiro(id);
  const lista = pagamentos.filter((p) => p.barbeiroId === id).sort((x, y) => y.data.localeCompare(x.data));
  abrirModal({
    titulo: `Pagamentos — ${b.nome}`,
    cancelar: false, ok: "Fechar",
    corpo: lista.length ? `
      <div class="tabela-wrap"><table>
        <tr><th>Data</th><th>Forma</th><th class="num">Valor</th><th></th></tr>
        ${lista.map((p) => `<tr><td>${dataCurta(p.data)}${p.obs ? `<br><span class="sub">${esc(p.obs)}</span>` : ""}</td><td>${esc(p.forma)}</td>
          <td class="num">${real(p.valor)}</td>
          <td class="num"><button type="button" class="btn-peq vermelho" data-acao="excluirPag" data-id="${p.id}">Excluir</button></td></tr>`).join("")}
      </table></div>
      <p class="sub">Saldo atual: ${real(saldoBarbeiro(id))}</p>` : vazio("Nenhum pagamento registrado ainda."),
  });
};

ACOES.excluirPag = (id) => {
  const p = pagamentos.find((x) => x.id === id);
  if (!p || !confirm(`Excluir o pagamento de ${real(p.valor)} (${dataCurta(p.data)})?`)) return;
  enviar("DELETE", `/api/dono/pagamentos/${id}`, undefined, "Pagamento excluído.").then(() => ACOES.histPag(p.barbeiroId));
};

// =====================================================================
//  FINANCEIRO
// =====================================================================
let fMes = mesAtual();
const CATEGORIAS_DESPESA = ["Aluguel", "Energia", "Água", "Internet", "Manutenção", "Material de uso (lâminas, toalhas...)", "Marketing", "Impostos", "Outros"];

function barras(itens) {
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return itens.map((i) => `
    <div class="barra-linha"><span>${esc(i.nome)}</span><div class="barra"><i style="width:${(i.valor / max) * 100}%"></i></div><span class="num">${i.rotulo}</span></div>`).join("");
}

function renderFinanceiro() {
  const r = resumo(fMes), rAnt = resumo(mesAnterior(fMes));
  const despMes = despesas.filter((d) => d.data.startsWith(fMes)).sort((a, b) => b.data.localeCompare(a.data));
  const pagMes = pagamentos.filter((p) => p.data.startsWith(fMes)).sort((a, b) => b.data.localeCompare(a.data));
  const faltas = agendamentos.filter((a) => a.status === "faltou" && a.dia.startsWith(fMes)).length;

  const porBarb = CONFIG.barbeiros.map((b) => {
    const at = r.at.filter((a) => a.barbeiroId === b.id);
    return { b, n: at.length, fat: soma(at, totalAg), com: soma(at, comissaoDe) };
  }).filter((x) => x.n || x.b.ativo !== false);

  const servMap = {};
  r.at.forEach((a) => { servMap[a.servico] ??= { n: 0, v: 0 }; servMap[a.servico].n++; servMap[a.servico].v += a.preco; });
  const servs = Object.entries(servMap).sort((a, b) => b[1].v - a[1].v);

  const prodMap = {};
  r.at.forEach((a) => (a.produtos || []).forEach((p) => {
    prodMap[p.nome] ??= { q: 0, v: 0, l: 0 };
    const custo = p.custo ?? CONFIG.produtos.find((x) => x.id === p.id)?.custo ?? 0;
    prodMap[p.nome].q += p.qtd; prodMap[p.nome].v += p.preco * p.qtd; prodMap[p.nome].l += (p.preco - custo) * p.qtd;
  }));
  const prods = Object.entries(prodMap).sort((a, b) => b[1].v - a[1].v);

  $("conteudo").innerHTML = `
    <div class="cab">
      <div><h1>Financeiro</h1><p class="sub" style="text-transform:capitalize">${nomeMes(fMes)}</p></div>
      <div class="acoes">
        <input type="month" value="${fMes}" data-mudar="mes">
        <button class="btn-peq ouro" data-acao="novaDesp">+ Despesa</button>
      </div>
    </div>

    <div class="indicadores">
      <div class="ind"><span>Receita</span><strong>${real(r.receita)}</strong><small>Serviços ${real(r.servicos)} · Produtos ${real(r.produtos)}</small>${variacao(r.receita, rAnt.receita)}</div>
      <div class="ind"><span>Comissões dos barbeiros</span><strong>${real(r.comissoes)}</strong></div>
      <div class="ind"><span>Custo dos produtos vendidos</span><strong>${real(r.custo)}</strong></div>
      <div class="ind"><span>Despesas</span><strong>${real(r.desp)}</strong><small>${despMes.length} lançamento(s)</small></div>
      <div class="ind destaque ${r.lucro >= 0 ? "positivo" : "negativo"}"><span>Lucro da barbearia</span><strong>${real(r.lucro)}</strong>
        <small>${r.receita ? `margem de ${((r.lucro / r.receita) * 100).toFixed(0)}%` : ""}</small>${variacao(r.lucro, rAnt.lucro)}</div>
      <div class="ind"><span>Atendimentos</span><strong>${r.at.length}</strong><small>ticket médio ${real(r.ticket)} · ${faltas} falta(s)</small></div>
    </div>
    <p class="sub" style="margin:-10px 0 20px">Lucro = receita − comissões − custo dos produtos vendidos − despesas. Conta só atendimentos marcados como “Atendido”.</p>

    <div class="colunas">
      <div>
        <div class="bloco">
          <h2>Por barbeiro</h2>
          <div class="tabela-wrap"><table>
            <tr><th>Barbeiro</th><th class="num">Atend.</th><th class="num">Faturou</th><th class="num">Comissão</th><th class="num">Saldo a pagar</th></tr>
            ${porBarb.map((x) => `<tr class="${x.b.ativo === false ? "inativo" : ""}"><td>${esc(x.b.nome)}</td><td class="num">${x.n}</td>
              <td class="num">${real(x.fat)}</td><td class="num">${real(x.com)}</td><td class="num">${real(Math.max(0, saldoBarbeiro(x.b.id)))}</td></tr>`).join("")}
          </table></div>
        </div>

        <div class="bloco">
          <h2>Despesas do mês</h2>
          ${despMes.length ? `<div class="tabela-wrap"><table>
            <tr><th>Data</th><th>Descrição</th><th class="num">Valor</th><th></th></tr>
            ${despMes.map((d) => `<tr><td>${dataCurta(d.data)}</td><td>${esc(d.descricao)}<br><span class="sub">${esc(d.categoria)}</span></td>
              <td class="num">${real(d.valor)}</td><td class="num"><button class="btn-peq vermelho" data-acao="excluirDesp" data-id="${d.id}">Excluir</button></td></tr>`).join("")}
          </table></div>` : vazio("Nenhuma despesa lançada neste mês. Lance aluguel, luz, água etc. para o lucro ficar certo.")}
        </div>
      </div>

      <div>
        <div class="bloco">
          <h2>Serviços mais vendidos</h2>
          ${servs.length ? barras(servs.map(([nome, x]) => ({ nome, valor: x.v, rotulo: `${x.n}× · ${real(x.v)}` }))) : vazio("Sem atendimentos neste mês.")}
        </div>
        <div class="bloco">
          <h2>Produtos vendidos</h2>
          ${prods.length ? `<div class="tabela-wrap"><table>
            <tr><th>Produto</th><th class="num">Qtd</th><th class="num">Venda</th><th class="num">Lucro</th></tr>
            ${prods.map(([nome, x]) => `<tr><td>${esc(nome)}</td><td class="num">${x.q}</td><td class="num">${real(x.v)}</td><td class="num margem-ok">${real(x.l)}</td></tr>`).join("")}
          </table></div>` : vazio("Nenhum produto vendido neste mês.")}
        </div>
        <div class="bloco">
          <h2>Pagamentos feitos aos barbeiros</h2>
          ${pagMes.length ? pagMes.map((p) => `<div class="ag-linha"><div class="ag-info"><strong>${esc(p.barbeiro)}</strong><span class="sub">${dataCurta(p.data)} · ${esc(p.forma)}</span></div><strong>${real(p.valor)}</strong></div>`).join("")
            : vazio("Nenhum pagamento neste mês.")}
        </div>
      </div>
    </div>`;
}

MUDAR.mes = (el) => { if (el.value) { fMes = el.value; renderFinanceiro(); } };

ACOES.novaDesp = () => abrirModal({
  titulo: "Nova despesa",
  ok: "Lançar despesa",
  corpo: `
    <label>Descrição<input name="descricao" required placeholder="Ex.: Aluguel de novembro"></label>
    <div class="dupla">
      <label>Categoria<select name="categoria">${CATEGORIAS_DESPESA.map((c) => `<option>${c}</option>`).join("")}</select></label>
      <label>Valor (R$)<input type="number" name="valor" min="0.01" step="0.01" required></label>
    </div>
    <label>Data<input type="date" name="data" required value="${fMes === mesAtual() ? hojeIso() : fMes + "-01"}"></label>
    <p class="sub">Compra de produtos para revenda não precisa ser lançada aqui: o custo deles já entra no lucro quando são vendidos.</p>`,
  aoSalvar: (fd) => {
    enviar("POST", "/api/dono/despesas", { descricao: fd.get("descricao"), categoria: fd.get("categoria"), valor: r2(Number(fd.get("valor"))), data: fd.get("data") },
      "Despesa lançada.");
  },
});

ACOES.excluirDesp = (id) => {
  const d = despesas.find((x) => x.id === id);
  if (!d || !confirm(`Excluir a despesa "${d.descricao}" de ${real(d.valor)}?`)) return;
  enviar("DELETE", `/api/dono/despesas/${id}`, undefined, "Despesa excluída.");
};

// =====================================================================
//  FUNCIONAMENTO (horários, dias fechados, senha, backup)
// =====================================================================
function renderHorarios() {
  const f = CONFIG.funcionamento;
  const fechadas = [...(f.datasFechadas || [])].sort((a, b) => a.data.localeCompare(b.data)).filter((x) => x.data >= hojeIso());

  $("conteudo").innerHTML = `
    <div class="cab"><h1>Funcionamento</h1></div>

    <div class="bloco">
      <h2>Dias e horários da semana</h2>
      <div class="semana">
        ${DIAS_SEMANA.map((nome, i) => `
          <div class="semana-linha ${f.semana[i].aberto ? "" : "fechado"}" id="sem${i}">
            <label class="check"><input type="checkbox" id="aberto${i}" data-mudar="semAberto" data-i="${i}" ${f.semana[i].aberto ? "checked" : ""}> ${nome}</label>
            <label>Abre<input type="time" id="abre${i}" value="${f.semana[i].abre}"></label>
            <label>Fecha<input type="time" id="fecha${i}" value="${f.semana[i].fecha}"></label>
          </div>`).join("")}
      </div>
      <div class="form-linha" style="margin-top:16px">
        <label>Intervalo entre horários
          <select id="cfgIntervalo">${[15, 20, 30, 40, 45, 60].map((m) => `<option value="${m}" ${Number(f.intervalo) === m ? "selected" : ""}>${m} minutos</option>`).join("")}</select>
        </label>
        <label>Cliente pode agendar com até
          <select id="cfgDias">${[7, 14, 21, 30, 60].map((d) => `<option value="${d}" ${Number(f.diasParaAgendar) === d ? "selected" : ""}>${d} dias de antecedência</option>`).join("")}</select>
        </label>
        <button class="btn-principal" data-acao="salvarHorarios">Salvar horários</button>
      </div>
    </div>

    <div class="bloco">
      <h2>Dias em que a barbearia vai fechar</h2>
      <p class="sub" style="margin-bottom:12px">Feriados, férias coletivas, reformas... Nesses dias os clientes não conseguem agendar.</p>
      <div class="form-linha">
        <label>Data<input type="date" id="fechData" min="${hojeIso()}"></label>
        <label>Motivo<input id="fechMotivo" placeholder="Ex.: Natal"></label>
        <button class="btn-peq ouro" data-acao="addFechada">Adicionar</button>
      </div>
      <div style="margin-top:12px">
        ${fechadas.length ? fechadas.map((x) => {
          const n = agendamentos.filter((a) => a.dia === x.data && a.status === "confirmado").length;
          return `<div class="ag-linha"><div class="ag-info"><strong>${dataBonita(x.data)}</strong><span class="sub">${esc(x.motivo || "Fechado")}${n ? ` · <span style="color:var(--perigo)">⚠ ${n} agendamento(s) neste dia</span>` : ""}</span></div>
            <button class="btn-peq vermelho" data-acao="rmFechada" data-id="${x.data}">Remover</button></div>`;
        }).join("") : vazio("Nenhum dia fechado programado.")}
      </div>
    </div>

    <div class="colunas">
      <div class="bloco">
        <h2>Senha do painel</h2>
        <div class="form">
          <label>Senha atual<input type="password" id="senhaAtual" autocomplete="current-password"></label>
          <label>Nova senha<input type="password" id="novaSenha" minlength="6" autocomplete="new-password"></label>
          <label>Repita a nova senha<input type="password" id="novaSenha2" autocomplete="new-password"></label>
          <button class="btn-peq ouro" data-acao="trocarSenha">Trocar senha</button>
        </div>
      </div>
      <div class="bloco">
        <h2>Cópia de segurança</h2>
        <p class="sub" style="margin-bottom:12px">Os dados ficam no arquivo <strong>servidor/barbearia.db</strong>. Baixe uma cópia de vez em quando para não perder nada.</p>
        <div class="botoes">
          <button class="btn-peq ouro" data-acao="backup">⬇ Baixar backup</button>
        </div>
        <p class="sub" style="margin-top:10px">Para restaurar: desligue o servidor, renomeie o backup para <strong>barbearia.db</strong> e coloque na pasta <strong>servidor</strong>.</p>
      </div>
    </div>`;
}

MUDAR.semAberto = (el) => $("sem" + el.dataset.i).classList.toggle("fechado", !el.checked);

ACOES.salvarHorarios = () => {
  const semana = DIAS_SEMANA.map((_, i) => ({ aberto: $("aberto" + i).checked, abre: $("abre" + i).value, fecha: $("fecha" + i).value }));
  const errado = semana.findIndex((d) => d.aberto && (!d.abre || !d.fecha || paraMin(d.abre) >= paraMin(d.fecha)));
  if (errado >= 0) { avisar(`${DIAS_SEMANA[errado]}: o horário de abrir precisa ser antes do de fechar.`); return; }
  Object.assign(CONFIG.funcionamento, { semana, intervalo: Number($("cfgIntervalo").value), diasParaAgendar: Number($("cfgDias").value) });
  salvarConfig();
  const conflito = agendamentos.filter((a) => a.dia >= hojeIso() && foraDoHorario(a)).length;
  avisar(conflito ? `Salvo. Atenção: ${conflito} agendamento(s) ficaram fora do horário (veja no Painel).` : "Horários salvos. Os clientes já veem os novos horários.");
};

ACOES.addFechada = () => {
  const data = $("fechData").value;
  if (!data) { avisar("Escolha a data."); return; }
  CONFIG.funcionamento.datasFechadas ??= [];
  if (CONFIG.funcionamento.datasFechadas.some((x) => x.data === data)) { avisar("Esse dia já está fechado."); return; }
  CONFIG.funcionamento.datasFechadas.push({ data, motivo: $("fechMotivo").value.trim() });
  salvarConfig();
  const n = agendamentos.filter((a) => a.dia === data && a.status === "confirmado").length;
  avisar(n ? `Dia fechado. Atenção: ${n} cliente(s) já tinham horário nesse dia.` : "Dia fechado adicionado.");
  renderHorarios();
};

ACOES.rmFechada = (data) => {
  CONFIG.funcionamento.datasFechadas = CONFIG.funcionamento.datasFechadas.filter((x) => x.data !== data);
  salvarConfig(); renderHorarios();
};

ACOES.trocarSenha = () => {
  const atual = $("senhaAtual").value, s1 = $("novaSenha").value, s2 = $("novaSenha2").value;
  if (s1.length < 6) { avisar("A nova senha precisa ter pelo menos 6 caracteres."); return; }
  if (s1 !== s2) { avisar("As senhas novas não são iguais."); return; }
  enviar("POST", "/api/dono/senha", { atual, nova: s1 }, "Senha trocada.");
};

ACOES.backup = async () => {
  try {
    const resp = await fetch("/api/dono/backup", { headers: { Authorization: "Bearer " + tokenDono } });
    if (!resp.ok) throw Object.assign(new Error((await resp.json().catch(() => ({}))).erro || "Não foi possível gerar o backup."), { status: resp.status });
    const url = URL.createObjectURL(await resp.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `backup-barbearia-${hojeIso()}.db`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { falhou(e); }
};

// =====================================================================
//  SERVIÇOS E PRODUTOS
// =====================================================================
function renderCatalogo() {
  const r = resumo(mesAtual());
  $("conteudo").innerHTML = `
    <div class="cab"><h1>Serviços e produtos</h1></div>

    <div class="bloco">
      <h2>Serviços <button class="btn-peq ouro" data-acao="novoServ">+ Novo serviço</button></h2>
      <div class="tabela-wrap"><table>
        <tr><th>Serviço</th><th class="num">Duração</th><th class="num">Preço</th><th class="num">Feitos no mês</th><th></th></tr>
        ${CONFIG.servicos.map((s) => `<tr class="${s.ativo === false ? "inativo" : ""}">
          <td>${esc(s.icone || "")} ${esc(s.nome)}${s.ativo === false ? ' <span class="sub">(desativado)</span>' : ""}</td>
          <td class="num">${s.duracao} min</td><td class="num">${real(s.preco)}</td>
          <td class="num">${r.at.filter((a) => a.servicoId === s.id).length}</td>
          <td class="num"><button class="btn-peq" data-acao="editarServ" data-id="${s.id}">Editar</button>
            <button class="btn-peq ${s.ativo === false ? "verde" : "vermelho"}" data-acao="toggleServ" data-id="${s.id}">${s.ativo === false ? "Ativar" : "Desativar"}</button></td></tr>`).join("")}
      </table></div>
    </div>

    <div class="bloco">
      <h2>Produtos <button class="btn-peq ouro" data-acao="novoProd">+ Novo produto</button></h2>
      <div class="tabela-wrap"><table>
        <tr><th>Produto</th><th class="num">Preço</th><th class="num">Custo</th><th class="num">Margem</th><th class="num">Estoque</th><th></th></tr>
        ${CONFIG.produtos.map((p) => {
          const disp = estoqueDisponivel(p, agendamentos), reserv = p.estoque - disp;
          const margem = p.preco ? ((p.preco - (p.custo || 0)) / p.preco) * 100 : 0;
          return `<tr class="${p.ativo === false ? "inativo" : ""}">
          <td>${esc(p.icone || "")} ${esc(p.nome)}<br><span class="sub">${esc(p.categoria)}${p.ativo === false ? " · desativado" : ""}</span></td>
          <td class="num">${real(p.preco)}</td><td class="num">${real(p.custo)}</td>
          <td class="num margem-ok">${margem.toFixed(0)}%</td>
          <td class="num" ${disp <= 3 ? 'style="color:var(--perigo)"' : ""}>${p.estoque}${reserv ? `<br><span class="sub">${reserv} reservado(s)</span>` : ""}</td>
          <td class="num"><button class="btn-peq verde" data-acao="addEstoque" data-id="${p.id}">+ Estoque</button>
            <button class="btn-peq" data-acao="editarProd" data-id="${p.id}">Editar</button>
            <button class="btn-peq ${p.ativo === false ? "verde" : "vermelho"}" data-acao="toggleProd" data-id="${p.id}">${p.ativo === false ? "Ativar" : "Desativar"}</button></td></tr>`;
        }).join("")}
      </table></div>
      <p class="sub" style="margin-top:10px">“Reservado” = produtos que clientes já pediram no agendamento e ainda não foram entregues.</p>
    </div>`;
}

function formServico(s = {}) {
  return `
    <div class="dupla">
      <label>Nome<input name="nome" required value="${esc(s.nome || "")}"></label>
      <label>Ícone (emoji)<input name="icone" maxlength="4" value="${esc(s.icone || "💈")}"></label>
    </div>
    <div class="dupla">
      <label>Preço (R$)<input type="number" name="preco" min="0" step="0.01" required value="${s.preco ?? ""}"></label>
      <label>Duração (minutos)<input type="number" name="duracao" min="10" step="5" required value="${s.duracao ?? 30}"></label>
    </div>`;
}
const lerServico = (fd) => ({ nome: fd.get("nome").trim(), icone: fd.get("icone").trim(), preco: r2(Number(fd.get("preco"))), duracao: Number(fd.get("duracao")) });

ACOES.novoServ = () => abrirModal({ titulo: "Novo serviço", ok: "Adicionar", corpo: formServico(),
  aoSalvar: (fd) => { CONFIG.servicos.push({ id: novoId("s"), ...lerServico(fd), ativo: true }); salvarConfig(); avisar("Serviço adicionado."); renderAba(); } });
ACOES.editarServ = (id) => {
  const s = CONFIG.servicos.find((x) => x.id === id);
  abrirModal({ titulo: `Editar ${s.nome}`, corpo: formServico(s) + `<p class="sub">Agendamentos já marcados mantêm o preço antigo.</p>`,
    aoSalvar: (fd) => { Object.assign(s, lerServico(fd)); salvarConfig(); avisar("Serviço atualizado."); renderAba(); } });
};
ACOES.toggleServ = (id) => {
  const s = CONFIG.servicos.find((x) => x.id === id);
  s.ativo = s.ativo === false; salvarConfig(); renderAba();
};

function formProduto(p = {}) {
  const cats = [...new Set(CONFIG.produtos.map((x) => x.categoria))];
  return `
    <div class="dupla">
      <label>Nome<input name="nome" required value="${esc(p.nome || "")}"></label>
      <label>Ícone (emoji)<input name="icone" maxlength="4" value="${esc(p.icone || "🧴")}"></label>
    </div>
    <label>Categoria<input name="categoria" list="listaCats" required value="${esc(p.categoria || "")}"></label>
    <datalist id="listaCats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
    <div class="dupla">
      <label>Preço de venda (R$)<input type="number" name="preco" min="0" step="0.01" required value="${p.preco ?? ""}"></label>
      <label>Custo (R$)<input type="number" name="custo" min="0" step="0.01" required value="${p.custo ?? ""}"></label>
    </div>
    <label>Estoque<input type="number" name="estoque" min="0" step="1" required value="${p.estoque ?? 0}"></label>`;
}
const lerProduto = (fd) => ({
  nome: fd.get("nome").trim(), icone: fd.get("icone").trim(), categoria: fd.get("categoria").trim(),
  preco: r2(Number(fd.get("preco"))), custo: r2(Number(fd.get("custo"))), estoque: Math.max(0, Math.floor(Number(fd.get("estoque")))),
});

ACOES.novoProd = () => abrirModal({ titulo: "Novo produto", ok: "Adicionar", corpo: formProduto(),
  aoSalvar: (fd) => { CONFIG.produtos.push({ id: novoId("p"), ...lerProduto(fd), ativo: true }); salvarConfig(); avisar("Produto adicionado."); renderAba(); } });
ACOES.editarProd = (id) => {
  const p = CONFIG.produtos.find((x) => x.id === id);
  abrirModal({ titulo: `Editar ${p.nome}`, corpo: formProduto(p),
    aoSalvar: (fd) => { Object.assign(p, lerProduto(fd)); salvarConfig(); avisar("Produto atualizado."); renderAba(); } });
};
ACOES.toggleProd = (id) => {
  const p = CONFIG.produtos.find((x) => x.id === id);
  p.ativo = p.ativo === false; salvarConfig(); renderAba();
};
ACOES.addEstoque = (id) => {
  const p = CONFIG.produtos.find((x) => x.id === id);
  abrirModal({
    titulo: `Repor estoque — ${p.nome}`, ok: "Adicionar ao estoque",
    corpo: `<p class="sub">Estoque atual: ${p.estoque}</p><label>Quantidade que chegou<input type="number" name="qtd" min="1" step="1" required></label>`,
    aoSalvar: (fd) => {
      const q = Math.floor(Number(fd.get("qtd")));
      if (!(q > 0)) { avisar("Digite uma quantidade válida."); return false; }
      p.estoque += q; salvarConfig(); avisar(`${q} unidade(s) adicionadas. Estoque: ${p.estoque}.`); renderAba();
    },
  });
};

// =====================================================================
//  CLIENTES
// =====================================================================
let buscaCli = "";

function clientesAgrupados() {
  const mapa = new Map();
  const novo = (nome, tel, cadastrado) => ({ nome, tel, cadastrado, visitas: 0, faltas: 0, gasto: 0, ultima: null, proxima: null });
  usuarios.forEach((u) => mapa.set("u" + u.id, novo(u.nome, u.tel, true)));
  agendamentos.forEach((a) => {
    const k = a.clienteId != null ? "u" + a.clienteId : "t" + (soDigitos(a.telefone) || a.cliente);
    if (!mapa.has(k)) mapa.set(k, novo(a.cliente, soDigitos(a.telefone), false));
    const c = mapa.get(k);
    if (a.status === "atendido") { c.visitas++; c.gasto += totalAg(a); if (!c.ultima || a.dia > c.ultima) c.ultima = a.dia; }
    if (a.status === "faltou") c.faltas++;
    if (a.status === "confirmado" && !pendente(a)) { const q = a.dia + " " + a.hora; if (!c.proxima || q < c.proxima) c.proxima = q; }
  });
  return [...mapa.values()].sort((a, b) => b.gasto - a.gasto);
}
const diasDesde = (iso) => Math.floor((new Date() - dataDe(iso)) / 86400000);

function renderClientes() {
  const todos = clientesAgrupados();
  const sumidos = todos.filter((c) => c.ultima && !c.proxima && diasDesde(c.ultima) > 30);
  $("conteudo").innerHTML = `
    <div class="cab"><h1>Clientes</h1></div>
    <div class="indicadores">
      <div class="ind"><span>Clientes</span><strong>${todos.length}</strong><small>${todos.filter((c) => c.cadastrado).length} com conta no app</small></div>
      <div class="ind"><span>Voltaram mais de uma vez</span><strong>${todos.filter((c) => c.visitas >= 2).length}</strong></div>
      <div class="ind"><span>Sumidos (+30 dias)</span><strong>${sumidos.length}</strong><small>chame no WhatsApp para voltar</small></div>
    </div>
    <div class="bloco">
      <input type="search" placeholder="Buscar por nome ou telefone..." value="${esc(buscaCli)}" data-digitar="buscaCli" style="margin-bottom:12px">
      <div class="tabela-wrap" id="listaCli"></div>
    </div>`;
  preencherClientes(todos);
}

function preencherClientes(todos = clientesAgrupados()) {
  const b = buscaCli.toLowerCase(), bd = soDigitos(buscaCli);
  const lista = todos.filter((c) => !b || c.nome.toLowerCase().includes(b) || (bd && c.tel.includes(bd)));
  $("listaCli").innerHTML = lista.length ? `<table>
    <tr><th>Cliente</th><th class="num">Visitas</th><th class="num">Gastou</th><th>Última visita</th><th>Próximo horário</th></tr>
    ${lista.map((c) => {
      const sumido = c.ultima && !c.proxima && diasDesde(c.ultima) > 30;
      return `<tr>
        <td><strong>${esc(c.nome)}</strong><br><span class="sub">${fmtTel(c.tel)} ${linkZap(c.tel)}${c.faltas ? ` · ${c.faltas} falta(s)` : ""}</span></td>
        <td class="num">${c.visitas}</td><td class="num">${real(c.gasto)}</td>
        <td>${c.ultima ? `${dataCurta(c.ultima)}${sumido ? `<br><span class="sub" style="color:var(--perigo)">há ${diasDesde(c.ultima)} dias</span>` : ""}` : "—"}</td>
        <td>${c.proxima ? `${dataCurta(c.proxima.slice(0, 10))} às ${c.proxima.slice(11)}` : "—"}</td></tr>`;
    }).join("")}
  </table>` : vazio("Nenhum cliente encontrado.");
}
DIGITAR.buscaCli = (el) => { buscaCli = el.value; preencherClientes(); };

// ================= Início =================
mostrarTela("telaLoginDono");
if (tokenDono) {
  abrirPainel().catch((e) => {
    tokenDono = null;
    try { sessionStorage.removeItem("tokenDono"); } catch {}
    if (e.status !== 401) avisar(e.message);
  });
}
