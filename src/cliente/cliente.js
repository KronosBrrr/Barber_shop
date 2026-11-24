// =====================================================================
//  ÁREA DO CLIENTE — login, tela inicial e pedidos anteriores.
//  O agendamento (src/agendamento) e o pagamento (src/pagamento) são módulos à parte.
// =====================================================================

// ================= Dados (vêm do servidor) =================
let token = ler("tokenCliente", null);
let usuario = null;
let agendamentos = []; // agendamentos do cliente logado
let ocupados = [];     // horários já ocupados na barbearia (sem dados de outros clientes)

const meusAgendamentos = () => agendamentos;

async function carregarConfig() {
  const c = await carregarConfigSite();   // compartilhado/config.js
  ocupados = c.ocupados;
}

async function carregarMeusDados() {
  const d = await api("GET", "/api/clientes/eu", undefined, token);
  usuario = d.cliente;
  agendamentos = d.agendamentos;
}

// ================= Login =================
$("irCriar").addEventListener("click", () => { $("formEntrar").hidden = true; $("formCriar").hidden = false; });
$("irEntrar").addEventListener("click", () => { $("formCriar").hidden = true; $("formEntrar").hidden = false; });

async function enviarLogin(form, erroId, caminho, corpo) {
  const botao = form.querySelector("button[type=submit]");
  botao.disabled = true;
  $(erroId).textContent = "";
  try {
    const r = await api("POST", caminho, corpo);
    await entrar(r.token);
  } catch (e) {
    $(erroId).textContent = e.message;
  } finally {
    botao.disabled = false;
  }
}

$("formEntrar").addEventListener("submit", (e) => {
  e.preventDefault();
  enviarLogin($("formEntrar"), "erroEntrar", "/api/clientes/login",
    { telefone: $("entrarTel").value, senha: $("entrarSenha").value });
});

$("formCriar").addEventListener("submit", (e) => {
  e.preventDefault();
  const tel = soDigitos($("criarTel").value);
  if (tel.length < 10) { $("erroCriar").textContent = "Digite um WhatsApp válido com DDD."; return; }
  enviarLogin($("formCriar"), "erroCriar", "/api/clientes/cadastro",
    { nome: $("criarNome").value, telefone: tel, senha: $("criarSenha").value });
});

async function entrar(novoToken) {
  token = novoToken;
  salvar("tokenCliente", token);
  await carregarMeusDados();
  $("formEntrar").reset(); $("formCriar").reset();
  atualizarMenu();
  irParaInicio();
}

// Itens do header com data-so-logado só aparecem depois do login
function atualizarMenu() {
  document.querySelectorAll("[data-so-logado]").forEach((el) => (el.hidden = !usuario));
}

// Veio do botão "Agendar meu horário" da página inicial (/cliente#agendar)? Já abre o agendamento.
function irParaInicio() {
  if (location.hash === "#agendar") {
    history.replaceState(null, "", location.pathname);
    iniciarAgendamento();
    return;
  }
  renderInicio();
  mostrarTela("telaInicio");
}

function sair() {
  if (token) api("POST", "/api/logout", {}, token).catch(() => {});
  token = null; usuario = null; agendamentos = [];
  salvar("tokenCliente", null);
  $("formCriar").hidden = true; $("formEntrar").hidden = false;
  atualizarMenu();
  mostrarTela("telaLogin");
}
$("btnSair").addEventListener("click", sair);

// Sessão expirada → volta pro login
function tratarErro(e) {
  if (e.status === 401) { sair(); avisar("Sua sessão expirou. Entre de novo."); return; }
  avisar(e.message);
}

// ================= Início =================
function saudacaoDoHorario() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia ☀️" : h < 18 ? "Boa tarde 👋" : "Boa noite 🌙";
}

function renderInicio() {
  const primeiroNome = usuario.nome.split(" ")[0];
  $("avatarUsuario").textContent = primeiroNome[0].toUpperCase();
  $("saudacao").textContent = saudacaoDoHorario();
  $("nomeBoasVindas").textContent = `Bem-vindo, ${primeiroNome}!`;

  const meus = meusAgendamentos();

  // Próximo horário em destaque
  const proximo = meus
    .filter((a) => statusDe(a) === "agendado")
    .sort((a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora))[0];
  $("proximoHorario").innerHTML = proximo ? `
    <div class="cartao-proximo">
      <p class="rotulo">Seu próximo horário</p>
      <div class="data-grande">
        <div class="dia-cal"><strong>${dataDe(proximo.dia).getDate()}</strong><span>${dataDe(proximo.dia).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span></div>
        <div>
          <h3>${esc(proximo.servico)} às ${proximo.hora}</h3>
          <p class="sub">${dataBonita(proximo.dia)} · com ${esc(proximo.barbeiro)}</p>
        </div>
      </div>
      ${proximo.produtos?.length ? `<p class="entrega">🎁 Seus produtos serão entregues neste atendimento</p>${chipsProdutos(proximo)}` : ""}
    </div>` : "";

  // Histórico
  const lista = [...meus].sort((a, b) => (b.dia + b.hora).localeCompare(a.dia + a.hora));
  // só os 5 mais recentes aparecem; o resto fica no "Ver mais"
  const cartoes = lista.map((a) => {
        const st = statusDe(a);
        const rotulo = { agendado: "Agendado", concluido: "Concluído", cancelado: "Cancelado", faltou: "Não compareceu" }[st];
        return `
        <div class="pedido ${st}">
          <div class="pedido-topo">
            <div>
              <strong>${esc(a.servico)}</strong>
              <p class="sub">${dataCurta(a.dia)} às ${a.hora} · ${esc(a.barbeiro)}</p>
            </div>
            <span class="status ${st}">${rotulo}</span>
          </div>
          ${chipsProdutos(a)}
          <div class="pedido-rodape">
            <span class="sub">${esc(a.pagamento)}${a.pagamentoDetalhe ? ` · ${esc(a.pagamentoDetalhe)}` : ""} · <strong class="valor">${real(a.total)}</strong>
              ${st === "agendado" ? etiquetaPagamento(a) : ""}</span>
            <div class="acoes-pedido">
              ${st === "agendado"
                ? `${["pendente", "pix_aguardando"].includes(a.pagamentoStatus)
                      ? `<button class="btn-texto" data-pagar="${a.id}">${a.pagamentoStatus === "pix_aguardando" ? "⚡ Ver Pix" : "💳 Pagar agora"}</button>` : ""}
                   <button class="btn-texto perigo" data-cancelar="${a.id}">Cancelar</button>`
                : `<button class="btn-texto" data-repetir="${a.id}">↻ Agendar de novo</button>`}
            </div>
          </div>
        </div>`;
      });
  const vm = verMais("historico", cartoes, 5);
  $("historico").innerHTML = lista.length === 0
    ? `<div class="vazio">
         <span class="icone">💈</span>
         <p>Você ainda não fez nenhum pedido.</p>
         <p class="sub">Toque em <strong>Realizar agendamento</strong> para marcar seu primeiro horário.</p>
       </div>`
    : vm.itens + vm.botao;

  $("historico").querySelectorAll("[data-cancelar]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Deseja cancelar este agendamento?")) return;
      try {
        const r = await api("POST", `/api/agendamentos/${b.dataset.cancelar}/cancelar`, {}, token);
        await carregarMeusDados();
        renderInicio();
        avisar(r.mensagem ? `Cancelado. ${r.mensagem}` : "Agendamento cancelado.");
      } catch (e) { tratarErro(e); }
    }));
  $("historico").querySelectorAll("[data-pagar]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = agendamentos.find((x) => x.id === Number(b.dataset.pagar));
      abrirPagamento(a, metodoDe(a.pagamento));
    }));
  $("historico").querySelectorAll("[data-repetir]").forEach((b) =>
    b.addEventListener("click", () => repetir(agendamentos.find((a) => a.id === Number(b.dataset.repetir)))));
}

function etiquetaPagamento(a) {
  return {
    pago: `<span class="status pago">✓ Pago</span>`,
    pix_aguardando: `<span class="status aguardando">Pix em confirmação</span>`,
    pendente: `<span class="status pendente">Pagamento pendente</span>`,
  }[a.pagamentoStatus] || "";
}

$("btnAgendar").addEventListener("click", () => iniciarAgendamento());
// Botões do header (cliente.html)
const podeSairDoAgendamento = () =>
  $("telaAgendar").hidden || !pedido?.servico || confirm("Sair sem terminar o agendamento?");
$("navAgendar").addEventListener("click", () => { if (podeSairDoAgendamento()) iniciarAgendamento(); });
$("navPedidos").addEventListener("click", () => {
  if (!podeSairDoAgendamento()) return;
  if ($("telaInicio").hidden) { renderInicio(); mostrarTela("telaInicio"); }
  $("tituloPedidos").scrollIntoView({ behavior: "smooth" });
});

function mostrarSucesso(a, titulo, linhaPagamento) {
  $("tituloSucesso").textContent = titulo;
  $("detalheSucesso").innerHTML = `
    <p><strong>${esc(a.servico)}</strong> com ${esc(a.barbeiro)}</p>
    <p>${dataBonita(a.dia)} às <strong>${a.hora}</strong></p>
    ${a.produtos.length ? `<p class="entrega">🎁 ${a.produtos.reduce((s, p) => s + p.qtd, 0)} produto(s) serão entregues no seu atendimento</p>` : ""}
    ${linhaPagamento}`;
  mostrarTela("telaSucesso");
}

$("btnVoltarInicio").addEventListener("click", () => { renderInicio(); mostrarTela("telaInicio"); });

// ================= Configurações =================
$("navConfig").addEventListener("click", () => {
  if (!podeSairDoAgendamento()) return;
  renderConfig();
  mostrarTela("telaConfig");
});

function renderConfig() {
  desenharConfiguracoes($("configCliente"), {
    login: fmtTel(usuario.tel), loginRotulo: "WhatsApp", loginBruto: usuario.tel,
    dados: { nome: usuario.nome, email: usuario.email }, campos: ["nome", "email"], minimo: 4,
    salvarDados: async (dados) => {
      try {
        const r = await api("PUT", "/api/clientes/eu", dados, token);
        usuario = r.cliente;
        await carregarMeusDados();
        avisar("Dados salvos.");
        renderConfig();
      } catch (e) { tratarErro(e); }
    },
    trocarSenha: async (atual, nova) => {
      try { await api("POST", "/api/clientes/senha", { atual, nova }, token); avisar("Senha trocada!"); }
      catch (e) { tratarErro(e); return false; }
    },
  });
}

// Criou senha nova pelo "esqueci minha senha": a conta sai de todos os aparelhos, então entra de novo
document.addEventListener("barbearia:senha-recuperada", () => { if (token) sair(); });

$("navInicio").addEventListener("click", () => { if (podeSairDoAgendamento()) { renderInicio(); mostrarTela("telaInicio"); } });

// ================= Início do app =================
document.addEventListener("DOMContentLoaded", async () => {
  try { await carregarConfig(); } catch (e) { avisar(e.message); }
  if (token) {
    try {
      await carregarMeusDados();
      atualizarMenu();
      irParaInicio();
      return;
    } catch (e) {
      if (e.status === 401) { token = null; salvar("tokenCliente", null); }
      else avisar(e.message);
    }
  }
  atualizarMenu();
  mostrarTela("telaLogin");
});
