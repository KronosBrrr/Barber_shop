// =====================================================================
//  ABA FUNCIONAMENTO — Mercado Pago, Pix e parcelas, horários e dias fechados
//  (usa as funções do núcleo: src/dono/dono.js)
// =====================================================================

function renderHorarios() {
  const f = CONFIG.funcionamento;
  const fechadas = [...(f.datasFechadas || [])].sort((a, b) => a.data.localeCompare(b.data)).filter((x) => x.data >= hojeIso());

  $("conteudo").innerHTML = `
    <div class="cab"><h1>Funcionamento</h1></div>

    <div class="bloco">
      <h2>🤝 Mercado Pago ${CONFIG.pagamentos.mpTokenFinal ? `<span class="pg pago">✓ conectado ${CONFIG.pagamentos.mpTeste ? "(modo de teste)" : "(cobrando de verdade)"}</span>` : `<span class="pg na_barbearia">desligado</span>`}</h2>
      <p class="sub" style="margin-bottom:12px">Com o Mercado Pago ligado, o cartão cobra de verdade, o Pix é confirmado sozinho
        e o <strong>reembolso</strong> volta automático para o cliente quando um pedido pago é cancelado.
        Pegue as credenciais em <strong>mercadopago.com.br/developers → Suas integrações → Credenciais</strong>.
        Para testar sem dinheiro de verdade, use as credenciais de <strong>teste</strong> (começam com TEST-).</p>
      <div class="form-linha">
        <label>Public Key<input id="mpPublica" value="${esc(CONFIG.pagamentos.mpPublicKey || "")}" placeholder="APP_USR-... ou TEST-..."></label>
        <label>Access Token<input id="mpToken" type="password" autocomplete="off"
          placeholder="${CONFIG.pagamentos.mpTokenFinal ? `guardado (…${esc(CONFIG.pagamentos.mpTokenFinal)}). Deixe vazio para manter` : "APP_USR-... ou TEST-..."}"></label>
        <button class="btn-principal" data-acao="salvarMP">Conectar</button>
        ${CONFIG.pagamentos.mpTokenFinal ? `<button class="btn-peq vermelho" data-acao="removerMP">Desligar</button>` : ""}
      </div>
      <p class="sub" style="margin-top:10px">🔒 O Access Token fica só no servidor e nunca aparece de novo na tela.</p>
    </div>

    <div class="bloco">
      <h2>💰 Pagamentos dos clientes</h2>
      <p class="sub" style="margin-bottom:12px">O QR code do Pix é gerado com esta chave, então o dinheiro cai direto na conta dela.
        ${CONFIG.pagamentos.chaveExemplo ? `<br><strong style="color:var(--perigo)">⚠ Esta é uma chave de exemplo. Troque pela chave Pix real da barbearia.</strong>` : ""}</p>
      <div class="form-linha">
        <label>Chave Pix<input id="pixChave" value="${esc(CONFIG.pagamentos.chavePix || "")}" placeholder="CPF, CNPJ, e-mail, +55 telefone ou aleatória"></label>
        <label>Nome do recebedor<input id="pixRecebedor" maxlength="25" value="${esc(CONFIG.pagamentos.recebedor || "")}"></label>
        <label>Cidade<input id="pixCidade" maxlength="15" value="${esc(CONFIG.pagamentos.cidade || "")}"></label>
        <label>Crédito em até
          <select id="cfgParcelas">${Array.from({ length: OPCOES.maxParcelasLimite }, (_, i) => i + 1).map((n) =>
            `<option value="${n}" ${Number(CONFIG.pagamentos.maxParcelas) === n ? "selected" : ""}>${n === 1 ? "1x (só à vista)" : `${n}x sem juros`}</option>`).join("")}</select>
        </label>
        <button class="btn-principal" data-acao="salvarPix">Salvar</button>
      </div>
      <p class="sub" style="margin-top:12px">💳 Cartão: <strong>${CONFIG.pagamentos.modoCartao === "teste" ? "modo de teste (não cobra de verdade)" : "ativo"}</strong>.
        Para cobrar de verdade é preciso contratar uma maquininha online (Mercado Pago, PagSeguro, Stone...). Veja <strong>servidor/pagamentos.py</strong>.</p>
    </div>

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
          <select id="cfgIntervalo">${OPCOES.intervalos.map((m) => `<option value="${m}" ${Number(f.intervalo) === m ? "selected" : ""}>${m} minutos</option>`).join("")}</select>
        </label>
        <label>Cliente pode agendar com até
          <select id="cfgDias">${OPCOES.diasAntecedencia.map((d) => `<option value="${d}" ${Number(f.diasParaAgendar) === d ? "selected" : ""}>${d} dias de antecedência</option>`).join("")}</select>
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



ACOES.salvarMP = async (_, botao) => {
  botao.disabled = true;
  botao.textContent = "Conferindo...";
  await enviar("PUT", "/api/dono/mercadopago", { publicKey: $("mpPublica").value.trim(), accessToken: $("mpToken").value.trim() });
  botao.disabled = false;
};
ACOES.removerMP = () => {
  if (!confirm("Desligar o Mercado Pago? O cartão volta para o modo de teste e o Pix volta a usar a chave da barbearia.")) return;
  enviar("PUT", "/api/dono/mercadopago", { remover: true });
};

ACOES.salvarPix = () => {
  Object.assign(CONFIG.pagamentos, { chavePix: $("pixChave").value.trim(), recebedor: $("pixRecebedor").value.trim(),
    cidade: $("pixCidade").value.trim(), maxParcelas: Number($("cfgParcelas").value) });
  salvarConfig().then((ok) => ok && avisar("Pagamentos salvos."));
};
