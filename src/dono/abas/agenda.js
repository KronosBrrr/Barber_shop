// =====================================================================
//  ABA AGENDA — agendamentos, atender, falta, cancelar, trocar barbeiro e agendar no balcão
//  (usa as funções do núcleo: src/dono/dono.js)
// =====================================================================

let fAg = { dia: hojeIso(), barbeiro: "todos", status: "todos" };

function renderAgenda() {
  let lista = agendamentos.slice();
  if (fAg.status === "pendente") lista = lista.filter(pendente);
  else if (fAg.status === "fora") lista = lista.filter((a) => a.dia >= hojeIso() && foraDoHorario(a));
  else if (fAg.status === "reembolso") lista = lista.filter((a) => a.reembolsoPendente);
  else {
    if (fAg.dia) lista = lista.filter((a) => a.dia === fAg.dia);
    else lista = lista.filter((a) => a.dia >= hojeIso());
    if (fAg.status !== "todos") lista = lista.filter((a) => a.status === fAg.status);
  }
  if (fAg.barbeiro !== "todos") lista = lista.filter((a) => a.barbeiroId === fAg.barbeiro);
  lista.sort(porHora);

  const comData = !fAg.dia || ["pendente", "fora", "reembolso"].includes(fAg.status);
  const validos = lista.filter((a) => a.status !== "cancelado" && a.status !== "faltou");
  let titulo = "Próximos agendamentos";
  if (fAg.status === "pendente") titulo = "Atendimentos pendentes de confirmação";
  else if (fAg.status === "fora") titulo = "Agendamentos fora do horário";
  else if (fAg.status === "reembolso") titulo = "Reembolsos pendentes";
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
        ${[["todos", "Todas as situações"], ["confirmado", "Agendados"], ["atendido", "Atendidos"], ["faltou", "Faltas"], ["cancelado", "Cancelados"], ["pendente", "⏳ Pendentes"], ["fora", "⚠ Fora do horário"], ["reembolso", "💸 Reembolsos pendentes"]]
          .map(([v, t]) => `<option value="${v}" ${fAg.status === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>

    <div class="bloco">
      <h2><span>${titulo}</span><span class="sub">${validos.length} atendimento(s) · ${real(soma(validos, totalAg))}</span></h2>
      ${lista.length ? juntarVerMais("agenda", lista.map((a) => linhaAg(a, comData)), 15) : vazio("Nada por aqui.")}
    </div>`;
}

function moverDia(delta) {
  const d = dataDe(fAg.dia || hojeIso());
  d.setDate(d.getDate() + delta);
  fAg.dia = chaveDia(d);
  if (["pendente", "fora", "reembolso"].includes(fAg.status)) fAg.status = "todos";
  renderAgenda();
}
ACOES.diaAnt = () => moverDia(-1);
ACOES.diaProx = () => moverDia(1);
ACOES.agHoje = () => { fAg.dia = hojeIso(); if (["pendente", "fora", "reembolso"].includes(fAg.status)) fAg.status = "todos"; renderAgenda(); };
ACOES.agTodas = () => { fAg.dia = ""; fAg.status = "todos"; renderAgenda(); };
MUDAR.agDia = (el) => { fAg.dia = el.value; if (["pendente", "fora", "reembolso"].includes(fAg.status)) fAg.status = "todos"; renderAgenda(); };
MUDAR.agBarb = (el) => { fAg.barbeiro = el.value; renderAgenda(); };
MUDAR.agStatus = (el) => { fAg.status = el.value; renderAgenda(); };

// ---- Marcar como atendido (e receber o pagamento)
ACOES.atender = (id) => {
  const a = agPorId(id), b = barbeiro(a.barbeiroId);
  const jaPago = a.pago;
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
        ? `<p class="sub">✓ Já pago pelo app (${esc(a.pagamento)}${a.pagamentoDetalhe ? ` · ${esc(a.pagamentoDetalhe)}` : ""}).</p>`
        : `<label>Como o cliente pagou?
             <select name="forma" required>
               ${OPCOES.formasBalcao.map((f) => `<option>${esc(f)}</option>`).join("")}
             </select>
           </label>`}
      ${a.produtos?.length ? `<p class="sub">📦 Os produtos entregues serão descontados do estoque.</p>` : ""}`,
    aoSalvar: (fd) => {
      enviar("POST", `/api/dono/agendamentos/${a.id}/atender`, { forma: fd.get("forma") }, `Atendimento de ${a.cliente} confirmado.`);
    },
  });
};

ACOES.confirmarPix = (id) => {
  const a = agPorId(id);
  if (!confirm(`Confirma que o Pix de ${real(totalAg(a))} de ${a.cliente} caiu na conta?\n\nConfira no app do banco antes.`)) return;
  enviar("POST", `/api/dono/agendamentos/${a.id}/confirmar-pix`, {}, "Pix confirmado. O cliente já vê o pedido como pago.");
};


ACOES.reembolsar = (id) => {
  const a = agPorId(id);
  const porPix = a.pagamento === "Pix" && a.pagamentoDetalhe !== "Pix via Mercado Pago";
  const texto = porPix
    ? `O Pix de ${real(totalAg(a))} foi direto para a chave da barbearia, então a devolução é feita por você pelo app do banco.\n\nJá devolveu o Pix para ${a.cliente}? Clique OK para marcar como devolvido.`
    : `Devolver ${real(totalAg(a))} para ${a.cliente}? O reembolso é feito pelo ${a.pagamentoDetalhe ? "mesmo meio de pagamento" : "cartão"}.`;
  if (!confirm(texto)) return;
  enviar("POST", `/api/dono/agendamentos/${a.id}/reembolsar`, {});
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
        <select name="pagamento">${[...OPCOES.formasApp].sort((a, b) => (b === "Pagar na barbearia") - (a === "Pagar na barbearia")).map((f) => `<option>${esc(f)}</option>`).join("")}</select>
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
