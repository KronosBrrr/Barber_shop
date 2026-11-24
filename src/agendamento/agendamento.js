// =====================================================================
//  AGENDAMENTO — passo a passo: serviço → barbeiro → dia e horário → produtos → confirmar.
//  Usa os dados do cliente (src/cliente/cliente.js) e abre o pagamento (src/pagamento).
// =====================================================================

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
        ${fotoOuInicial(b, "grande")}
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
          ${formasPagamento().filter(([v]) => v !== "Pix" || CONFIG.pagamentos?.pixAtivo !== false).map(([v, ic, titulo, desc]) => `
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
