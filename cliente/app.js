// (funções utilitárias e regras da agenda estão em comum.js)

// ================= Dados (vêm do servidor) =================
let token = ler("tokenCliente", null);
let usuario = null;
let agendamentos = []; // agendamentos do cliente logado
let ocupados = [];     // horários já ocupados na barbearia (sem dados de outros clientes)

const meusAgendamentos = () => agendamentos;

async function carregarConfig() {
  const c = await api("GET", "/api/config");
  aplicarConfig(c);
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
  renderInicio();
  mostrarTela("telaInicio");
}

function sair() {
  if (token) api("POST", "/api/logout", {}, token).catch(() => {});
  token = null; usuario = null; agendamentos = [];
  salvar("tokenCliente", null);
  $("formCriar").hidden = true; $("formEntrar").hidden = false;
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

function linhaProdutos(a) {
  if (!a.produtos?.length) return "";
  return `<div class="chips">${a.produtos.map((p) => `<span class="chip">📦 ${esc(p.nome)} ×${p.qtd}</span>`).join("")}</div>`;
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
      ${proximo.produtos?.length ? `<p class="entrega">🎁 Seus produtos serão entregues neste atendimento</p>${linhaProdutos(proximo)}` : ""}
    </div>` : "";

  // Histórico
  const lista = [...meus].sort((a, b) => (b.dia + b.hora).localeCompare(a.dia + a.hora));
  $("historico").innerHTML = lista.length === 0
    ? `<div class="vazio">
         <span class="icone">💈</span>
         <p>Você ainda não fez nenhum pedido.</p>
         <p class="sub">Toque em <strong>Realizar agendamento</strong> para marcar seu primeiro horário.</p>
       </div>`
    : lista.map((a) => {
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
          ${linhaProdutos(a)}
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
      }).join("");

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
$("navAgendar").addEventListener("click", () => iniciarAgendamento());
$("navPedidos").addEventListener("click", () => $("tituloPedidos").scrollIntoView({ behavior: "smooth" }));

// ================= Agendamento passo a passo =================
const PASSOS = ["Serviço", "Barbeiro", "Horário", "Produtos", "Confirmar"];
let passo = 0;
let pedido;

function novoPedido() {
  return { servico: null, barbeiro: null, dia: null, hora: null, produtos: {},
    pagamento: CONFIG.pagamentos?.pixAtivo === false ? "Cartão de crédito" : "Pix", obs: "" };
}

async function iniciarAgendamento(base) {
  // pega horários, preços e estoque atualizados antes de começar
  try { await carregarConfig(); } catch (e) { avisar(e.message); return; }
  if (base) {
    base.servico = SERVICOS.find((s) => s.id === base.servico.id) || null;
    base.barbeiro = BARBEIROS.find((b) => b.id === base.barbeiro.id) || null;
    if (!base.servico || !base.barbeiro) { avisar("Esse serviço ou barbeiro não está mais disponível."); base = undefined; }
  }
  pedido = base || novoPedido();
  passo = base ? 2 : 0;
  mostrarTela("telaAgendar");
  renderPasso();
}

function repetir(a) {
  const p = novoPedido();
  p.servico = { id: a.servicoId };
  p.barbeiro = { id: a.barbeiroId };
  (a.produtos || []).forEach((x) => { p.produtos[x.id] = x.qtd; });
  iniciarAgendamento(p).then(() => {
    // remove produtos que não existem mais ou estão sem estoque
    Object.keys(pedido.produtos).forEach((id) => {
      const prod = PRODUTOS.find((x) => x.id === id);
      if (!prod || prod.disponivel <= 0) delete pedido.produtos[id];
      else pedido.produtos[id] = Math.min(pedido.produtos[id], prod.disponivel);
    });
    atualizarRodape();
  });
}

$("btnFecharAgenda").addEventListener("click", () => {
  if (pedido.servico && !confirm("Sair sem terminar o agendamento?")) return;
  renderInicio();
  mostrarTela("telaInicio");
});
$("btnAnterior").addEventListener("click", () => {
  if (passo === 0) { $("btnFecharAgenda").click(); return; }
  passo--; renderPasso();
});
$("btnProximo").addEventListener("click", () => {
  if (!passoValido()) return;
  if (passo === PASSOS.length - 1) { confirmar(); return; }
  passo++; renderPasso();
});

function passoValido() {
  return [
    !!pedido.servico,
    !!pedido.barbeiro,
    !!(pedido.dia && pedido.hora),
    true,
    true,
  ][passo];
}

const totalProdutos = () =>
  Object.entries(pedido.produtos).reduce((s, [id, q]) => s + PRODUTOS.find((p) => p.id === id).preco * q, 0);
const totalPedido = () => (pedido.servico?.preco || 0) + totalProdutos();

function renderPasso() {
  $("etapas").innerHTML = PASSOS.map((nome, i) =>
    `<div class="etapa ${i < passo ? "feita" : ""} ${i === passo ? "atual" : ""}"><span>${i < passo ? "✓" : i + 1}</span><small>${nome}</small></div>`
  ).join("");

  [passoServico, passoBarbeiro, passoHorario, passoProdutos, passoConfirmar][passo]();

  $("totalParcial").textContent = real(totalPedido());
  $("btnAnterior").textContent = passo === 0 ? "Cancelar" : "Voltar";
  $("btnProximo").textContent =
    passo === PASSOS.length - 1 ? textoConfirmar()
    : passo === 3 && Object.keys(pedido.produtos).length === 0 ? "Pular" : "Continuar";
  $("btnProximo").disabled = !passoValido();
  window.scrollTo(0, 0);
}

function atualizarRodape() {
  $("totalParcial").textContent = real(totalPedido());
  $("btnProximo").disabled = !passoValido();
  if (passo === 3) $("btnProximo").textContent = Object.keys(pedido.produtos).length ? "Continuar" : "Pular";
}

// ---- Passo 1: serviço
function passoServico() {
  $("conteudoPasso").innerHTML = `
    <h2>Qual serviço você quer?</h2>
    <div class="grade">${SERVICOS.map((s) => `
      <button class="cartao ${pedido.servico?.id === s.id ? "selecionado" : ""}" data-id="${s.id}">
        <span class="icone">${s.icone}</span>
        <strong>${s.nome}</strong>
        <span class="sub">⏱ ${s.duracao} min</span>
        <span class="preco">${real(s.preco)}</span>
      </button>`).join("")}
    </div>`;
  $("conteudoPasso").querySelectorAll(".cartao").forEach((el) =>
    el.addEventListener("click", () => {
      pedido.servico = SERVICOS.find((s) => s.id === el.dataset.id);
      pedido.hora = null;
      passoServico(); atualizarRodape();
    }));
}

// ---- Passo 2: barbeiro
function passoBarbeiro() {
  $("conteudoPasso").innerHTML = `
    <h2>Com qual barbeiro?</h2>
    <div class="grade">${BARBEIROS.map((b) => `
      <button class="cartao ${pedido.barbeiro?.id === b.id ? "selecionado" : ""}" data-id="${b.id}">
        <span class="avatar">${b.nome[0]}</span>
        <strong>${b.nome}</strong>
        <span class="sub">${b.especialidade}</span>
      </button>`).join("")}
    </div>`;
  $("conteudoPasso").querySelectorAll(".cartao").forEach((el) =>
    el.addEventListener("click", () => {
      pedido.barbeiro = BARBEIROS.find((b) => b.id === el.dataset.id);
      pedido.hora = null;
      if (pedido.dia && !diaDisponivel(dataDe(pedido.dia))) pedido.dia = null;
      passoBarbeiro(); atualizarRodape();
    }));
}

// ---- Passo 3: dia e horário
function diaDisponivel(d) {
  return lojaAbertaNoDia(d) && (!pedido.barbeiro || barbeiroTrabalha(pedido.barbeiro, d));
}

function ocupado(barbeiroId, dia, inicio, duracao) {
  return ocupadoEm(ocupados, barbeiroId, dia, inicio, duracao);
}

function passoHorario() {
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  let dias = "";
  for (let i = 0; i < FUNCIONAMENTO.diasParaAgendar; i++) {
    const d = new Date(hoje); d.setDate(hoje.getDate() + i);
    const k = chaveDia(d);
    dias += `<button class="dia ${pedido.dia === k ? "selecionado" : ""}" data-dia="${k}" ${diaDisponivel(d) ? "" : "disabled"}>
      <span>${i === 0 ? "hoje" : d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span>
      <strong>${d.getDate()}</strong>
    </button>`;
  }

  let horas = `<p class="sub">Escolha um dia acima para ver os horários livres.</p>`;
  if (pedido.dia) {
    const lista = gradeHorarios(ocupados, pedido.barbeiro.id, pedido.dia, pedido.servico.duracao).map(({ hora: h, livre }) =>
      `<button class="hora ${pedido.hora === h ? "selecionado" : ""}" data-hora="${h}" ${livre ? "" : "disabled"}>${h}</button>`);
    horas = lista.length ? `<div class="horarios">${lista.join("")}</div>` : `<p class="sub">Sem horários neste dia.</p>`;
  }

  $("conteudoPasso").innerHTML = `
    <h2>Quando fica bom pra você?</h2>
    <p class="sub espaco-baixo">${esc(pedido.servico.nome)} com ${esc(pedido.barbeiro.nome)} · ${pedido.servico.duracao} min</p>
    <div class="dias">${dias}</div>
    ${horas}`;

  $("conteudoPasso").querySelectorAll(".dia:not([disabled])").forEach((el) =>
    el.addEventListener("click", () => { pedido.dia = el.dataset.dia; pedido.hora = null; passoHorario(); atualizarRodape(); }));
  $("conteudoPasso").querySelectorAll(".hora:not([disabled])").forEach((el) =>
    el.addEventListener("click", () => { pedido.hora = el.dataset.hora; passoHorario(); atualizarRodape(); }));
}

// ---- Passo 4: produtos (opcional)
let filtroLoja = "Todos";
function passoProdutos() {
  const cats = ["Todos", ...new Set(PRODUTOS.map((p) => p.categoria))];
  const lista = PRODUTOS.filter((p) => filtroLoja === "Todos" || p.categoria === filtroLoja);
  $("conteudoPasso").innerHTML = `
    <h2>Quer levar algum produto?</h2>
    <div class="banner-entrega">
      🎁 <span>Separamos tudo e <strong>entregamos no dia do seu atendimento</strong>, ${dataBonita(pedido.dia)} às ${pedido.hora}.</span>
    </div>
    <div class="filtros">${cats.map((c) => `<button class="filtro ${c === filtroLoja ? "ativo" : ""}" data-cat="${c}">${c}</button>`).join("")}</div>
    <div class="grade produtos">${lista.map((p) => {
      const q = pedido.produtos[p.id] || 0;
      const disp = p.disponivel;
      return `
      <div class="produto ${q ? "no-pedido" : ""}">
        <div class="foto">${p.icone}</div>
        <span class="tag">${esc(p.categoria)}</span>
        <strong>${esc(p.nome)}</strong>
        <span class="preco">${real(p.preco)}</span>
        ${q === 0
          ? `<button class="btn-add" data-id="${p.id}" data-d="1" ${disp <= 0 ? "disabled" : ""}>${disp <= 0 ? "Esgotado" : "+ Adicionar"}</button>`
          : `<div class="qtd">
               <button data-id="${p.id}" data-d="-1" aria-label="Diminuir">−</button>
               <span>${q}</span>
               <button data-id="${p.id}" data-d="1" aria-label="Aumentar" ${q >= disp ? "disabled" : ""}>+</button>
             </div>`}
      </div>`;
    }).join("")}</div>`;

  $("conteudoPasso").querySelectorAll(".filtro").forEach((el) =>
    el.addEventListener("click", () => { filtroLoja = el.dataset.cat; passoProdutos(); }));
  $("conteudoPasso").querySelectorAll("[data-d]").forEach((el) =>
    el.addEventListener("click", () => {
      const p = PRODUTOS.find((x) => x.id === el.dataset.id);
      const q = Math.min(p.disponivel, Math.max(0, (pedido.produtos[p.id] || 0) + Number(el.dataset.d)));
      if (q) pedido.produtos[p.id] = q; else delete pedido.produtos[p.id];
      passoProdutos(); atualizarRodape();
    }));
}

// ---- Passo 5: confirmar
function passoConfirmar() {
  const itens = Object.entries(pedido.produtos).map(([id, q]) => ({ ...PRODUTOS.find((p) => p.id === id), qtd: q }));
  $("conteudoPasso").innerHTML = `
    <h2>Confira seu pedido</h2>
    <div class="revisao">
      <div class="linha-rev"><span class="icone">${pedido.servico.icone}</span>
        <div><strong>${esc(pedido.servico.nome)}</strong><p class="sub">com ${esc(pedido.barbeiro.nome)}</p></div>
        <span>${real(pedido.servico.preco)}</span></div>
      <div class="linha-rev"><span class="icone">📅</span>
        <div><strong>${dataBonita(pedido.dia)}</strong><p class="sub">às ${pedido.hora}</p></div>
        <button class="btn-texto" data-ir="2">Alterar</button></div>
      ${itens.length ? `
        <p class="rotulo">Produtos — entregues no atendimento</p>
        ${itens.map((p) => `<div class="linha-rev"><span class="icone">${p.icone}</span>
          <div><strong>${p.nome}</strong><p class="sub">${p.qtd}× ${real(p.preco)}</p></div>
          <span>${real(p.preco * p.qtd)}</span></div>`).join("")}
      ` : `<div class="linha-rev"><span class="icone">📦</span><div><p class="sub">Nenhum produto</p></div><button class="btn-texto" data-ir="3">Adicionar</button></div>`}
      <div class="linha-rev total"><div><strong>Total</strong></div><strong>${real(totalPedido())}</strong></div>
    </div>

    <div class="form">
      <div>
        <p class="sub" style="margin-bottom:8px">Forma de pagamento</p>
        <div class="formas">
          ${FORMAS_PAGAMENTO.filter(([v]) => v !== "Pix" || CONFIG.pagamentos?.pixAtivo !== false).map(([v, ic, titulo, desc]) => `
            <button type="button" class="forma ${pedido.pagamento === v ? "selecionado" : ""}" data-forma="${v}">
              <span class="icone">${ic}</span><span>${titulo}<small>${desc}</small></span>
            </button>`).join("")}
        </div>
      </div>
      <label>Observação para o barbeiro (opcional)
        <textarea id="txtObs" rows="2" placeholder="Ex.: degradê baixo, não tirar o comprimento em cima">${esc(pedido.obs)}</textarea>
      </label>
    </div>`;

  $("conteudoPasso").querySelectorAll("[data-forma]").forEach((el) =>
    el.addEventListener("click", () => {
      pedido.pagamento = el.dataset.forma;
      $("conteudoPasso").querySelectorAll("[data-forma]").forEach((x) => x.classList.toggle("selecionado", x === el));
      $("btnProximo").textContent = textoConfirmar();
    }));
  $("txtObs").addEventListener("input", (e) => (pedido.obs = e.target.value));
  $("conteudoPasso").querySelectorAll("[data-ir]").forEach((el) =>
    el.addEventListener("click", () => { passo = Number(el.dataset.ir); renderPasso(); }));
}

async function confirmar() {
  const { servico, barbeiro, dia, hora } = pedido;
  const produtos = Object.entries(pedido.produtos).map(([id, qtd]) => ({ id, qtd }));
  $("btnProximo").disabled = true;
  let criado;
  try {
    const r = await api("POST", "/api/agendamentos", {
      servicoId: servico.id, barbeiroId: barbeiro.id, dia, hora, produtos,
      pagamento: pedido.pagamento, obs: pedido.obs.trim(),
    }, token);
    await carregarMeusDados();
    criado = agendamentos.find((a) => a.id === r.id);
  } catch (e) {
    $("btnProximo").disabled = false;
    if (e.status === 401) { tratarErro(e); return; }
    avisar(e.message);
    if (e.status === 409) {
      // horário ou estoque mudou enquanto o cliente escolhia
      await carregarConfig().catch(() => {});
      if (/horário/i.test(e.message)) { pedido.hora = null; passo = 2; }
      else { pedido.produtos = {}; passo = 3; }
      renderPasso();
    }
    return;
  }
  if (criado.pagamento === "Pagar na barbearia") {
    mostrarSucesso(criado, "Agendamento confirmado!", `<p class="sub">Pagamento na barbearia · Total ${real(criado.total)}</p>`);
  } else {
    abrirPagamento(criado, metodoDe(criado.pagamento));
  }
}

function mostrarSucesso(a, titulo, linhaPagamento) {
  $("tituloSucesso").textContent = titulo;
  $("detalheSucesso").innerHTML = `
    <p><strong>${esc(a.servico)}</strong> com ${esc(a.barbeiro)}</p>
    <p>${dataBonita(a.dia)} às <strong>${a.hora}</strong></p>
    ${a.produtos.length ? `<p class="entrega">🎁 ${a.produtos.reduce((s, p) => s + p.qtd, 0)} produto(s) serão entregues no seu atendimento</p>` : ""}
    ${linhaPagamento}`;
  mostrarTela("telaSucesso");
}

// ================= Pagamento (Pix e cartão) =================
const FORMAS_PAGAMENTO = [
  ["Pix", "⚡", "Pix", "QR code na hora"],
  ["Cartão de crédito", "💳", "Crédito", "em até 3x sem juros"],
  ["Cartão de débito", "💳", "Débito", "à vista"],
  ["Pagar na barbearia", "🏪", "Na barbearia", "no dia do atendimento"],
];
const metodoDe = (forma) => (forma === "Cartão de crédito" ? "credito" : forma === "Cartão de débito" ? "debito" : "pix");
const textoConfirmar = () => (pedido?.pagamento === "Pagar na barbearia" ? "Confirmar agendamento" : "Confirmar e pagar");

let pagando = null;   // agendamento que está sendo pago
let metodoPag = "pix";

function abrirPagamento(a, metodo) {
  pagando = a;
  const pixOk = CONFIG.pagamentos?.pixAtivo !== false;
  if (metodo === "pix" && !pixOk) metodo = "credito";
  $("pagResumo").textContent = `${a.servico} com ${a.barbeiro} · ${dataCurta(a.dia)} às ${a.hora}`;
  $("pagValor").textContent = real(a.total);
  $("abasPag").querySelector('[data-metodo="pix"]').hidden = !pixOk;
  $("avisoTeste").hidden = CONFIG.pagamentos?.modoCartao !== "teste";
  const max = CONFIG.pagamentos?.maxParcelas || 1;
  $("cartaoParcelas").innerHTML = Array.from({ length: max }, (_, i) =>
    `<option value="${i + 1}">${i + 1}x de ${real(a.total / (i + 1))}${i ? " sem juros" : " (à vista)"}</option>`).join("");
  $("formCartao").reset();
  $("erroCartao").textContent = "";
  atualizarCartaoVisual();
  mostrarTela("telaPagamento");
  escolherMetodo(metodo);
}

function escolherMetodo(m) {
  metodoPag = m;
  $("abasPag").querySelectorAll("[data-metodo]").forEach((b) => b.classList.toggle("ativo", b.dataset.metodo === m));
  $("painelPix").hidden = m !== "pix";
  $("formCartao").hidden = m === "pix";
  $("campoParcelas").hidden = m !== "credito";
  $("btnPagarCartao").textContent = `Pagar ${real(pagando.total)}`;
  if (m === "pix") gerarPix();
}
$("abasPag").addEventListener("click", (e) => {
  const b = e.target.closest("[data-metodo]");
  if (b) escolherMetodo(b.dataset.metodo);
});

async function gerarPix() {
  $("qrPix").innerHTML = `<span class="sub">Gerando QR code...</span>`;
  $("pixCodigo").value = "";
  try {
    const r = await api("POST", `/api/agendamentos/${pagando.id}/pix`, {}, token);
    $("pixCodigo").value = r.codigo;
    $("pixRecebedor").textContent = r.recebedor;
    if (window.qrcode) {
      const q = qrcode(0, "M");
      q.addData(r.codigo);
      q.make();
      $("qrPix").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } else {
      $("qrPix").innerHTML = `<span style="color:#333;font-size:.85rem;text-align:center">Sem internet para desenhar o QR code.<br>Use o Pix copia e cola abaixo.</span>`;
    }
  } catch (e) {
    $("qrPix").innerHTML = "";
    tratarErro(e);
  }
}

$("btnCopiarPix").addEventListener("click", async () => {
  const campo = $("pixCodigo");
  try { await navigator.clipboard.writeText(campo.value); }
  catch { campo.select(); document.execCommand("copy"); }
  avisar("Código Pix copiado!");
});

$("btnJaPaguei").addEventListener("click", async () => {
  const a = pagando;
  await carregarMeusDados().catch(() => {});
  mostrarSucesso(a, "Pix enviado!", `<p class="sub">Assim que a barbearia confirmar o recebimento de ${real(a.total)}, seu pedido aparece como <strong>pago</strong>.</p>`);
});

async function sairDoPagamento() {
  await carregarMeusDados().catch(() => {});
  renderInicio();
  mostrarTela("telaInicio");
  avisar("Seu horário está reservado. Você pode pagar depois em “Seus pedidos”.");
}
$("btnPagarDepois").addEventListener("click", sairDoPagamento);
$("btnFecharPagamento").addEventListener("click", sairDoPagamento);

// ---- Cartão: formatação e desenho do cartão
function bandeiraDe(n) {
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(n)) return "ELO";
  if (/^(606282|3841)/.test(n)) return "HIPERCARD";
  if (/^3[47]/.test(n)) return "AMEX";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return "MASTERCARD";
  if (/^4/.test(n)) return "VISA";
  return "CARTÃO";
}
function atualizarCartaoVisual() {
  const n = soDigitos($("cartaoNumero").value);
  $("cvNumero").textContent = (n.padEnd(16, "•").match(/.{1,4}/g) || []).join(" ");
  $("cvNome").textContent = $("cartaoNome").value.trim().toUpperCase() || "SEU NOME";
  $("cvValidade").textContent = $("cartaoValidade").value || "MM/AA";
  $("cvBandeira").textContent = bandeiraDe(n);
}
$("cartaoNumero").addEventListener("input", (e) => {
  e.target.value = soDigitos(e.target.value).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
  atualizarCartaoVisual();
});
$("cartaoValidade").addEventListener("input", (e) => {
  const d = soDigitos(e.target.value).slice(0, 4);
  e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  atualizarCartaoVisual();
});
$("cartaoCvv").addEventListener("input", (e) => (e.target.value = soDigitos(e.target.value).slice(0, 4)));
$("cartaoNome").addEventListener("input", atualizarCartaoVisual);

$("formCartao").addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = $("btnPagarCartao");
  botao.disabled = true;
  botao.textContent = "Processando...";
  $("erroCartao").textContent = "";
  try {
    const r = await api("POST", `/api/agendamentos/${pagando.id}/cartao`, {
      tipo: metodoPag,
      numero: $("cartaoNumero").value,
      nome: $("cartaoNome").value,
      validade: $("cartaoValidade").value,
      cvv: $("cartaoCvv").value,
      parcelas: Number($("cartaoParcelas").value) || 1,
    }, token);
    if (!r.aprovado) { $("erroCartao").textContent = r.mensagem; return; }
    const a = pagando;
    $("formCartao").reset();
    await carregarMeusDados().catch(() => {});
    mostrarSucesso(a, "Pagamento aprovado!", `
      <p class="sub">💳 ${esc(r.bandeira)} final ${esc(r.final)}${r.parcelas > 1 ? ` · ${r.parcelas}x de ${real(a.total / r.parcelas)}` : ""} · ${real(a.total)}</p>
      ${r.modoTeste ? `<p class="aviso-teste">🧪 Modo de teste: nada foi cobrado de verdade.</p>` : ""}`);
  } catch (er) {
    if (er.status === 401) tratarErro(er);
    else $("erroCartao").textContent = er.message;
  } finally {
    botao.disabled = false;
    botao.textContent = `Pagar ${real(pagando.total)}`;
  }
});

$("btnVoltarInicio").addEventListener("click", () => { renderInicio(); mostrarTela("telaInicio"); });

// ================= Início do app =================
(async () => {
  mostrarTela("telaLogin");
  try { await carregarConfig(); } catch (e) { avisar(e.message); }
  if (!token) return;
  try {
    await carregarMeusDados();
    renderInicio();
    mostrarTela("telaInicio");
  } catch (e) {
    if (e.status === 401) { token = null; salvar("tokenCliente", null); }
    else avisar(e.message);
  }
})();
