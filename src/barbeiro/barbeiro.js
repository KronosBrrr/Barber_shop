// =====================================================================
//  PAINEL DO BARBEIRO
//  O barbeiro vê a agenda dele, quanto vai receber e o que já recebeu.
//  A conta é criada pelo dono (Barbeiros → Adicionar / Editar).
// =====================================================================

// FUNCIONAMENTO (dias e horários da barbearia) está em compartilhado/config.js e é preenchido em recarregar()
let tokenBarb = ler("tokenBarbeiro", null);
let dados = null;          // resposta de /api/barbeiro/dados
let abaBarb = "inicio";
let diaAgenda = chaveDia(new Date());
let mesGanhos = chaveDia(new Date()).slice(0, 7);

const ganhoDe = (a) => (a.status === "atendido" ? a.comissaoValor || 0 : a.status === "confirmado" ? a.comissaoPrevista || 0 : 0);
const pagamentoDoRepasse = (id) => dados.pagamentos.find((p) => p.id === id);

// ================= Login =================
$("formBarbeiro").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("erroBarbeiro").textContent = "";
  const botao = $("formBarbeiro").querySelector("button");
  botao.disabled = true;
  try {
    const r = await api("POST", "/api/barbeiro/login", { telefone: $("barbTel").value, senha: $("barbSenha").value });
    tokenBarb = r.token;
    salvar("tokenBarbeiro", tokenBarb);
    $("barbSenha").value = "";
    await abrirPainel();
  } catch (er) {
    $("erroBarbeiro").textContent = er.message;
  } finally { botao.disabled = false; }
});

function sairBarbeiro() {
  if (tokenBarb) api("POST", "/api/logout", {}, tokenBarb).catch(() => {});
  tokenBarb = null; dados = null;
  salvar("tokenBarbeiro", null);
  mostrarTela("telaLoginBarbeiro");
}
$("sairBarbeiro").addEventListener("click", sairBarbeiro);

async function recarregar() {
  dados = await api("GET", "/api/barbeiro/dados", undefined, tokenBarb);
  FUNCIONAMENTO = dados.funcionamento;  // usado pelas regras de dia aberto/fechado
}
async function abrirPainel() {
  await recarregar();
  mostrarTela("telaBarbeiro");
  render();
}
function falhou(e) {
  if (e.status === 401) { sairBarbeiro(); avisar("Sua sessão expirou. Entre de novo."); }
  else avisar(e.message);
}

// atualiza sozinho a cada minuto (ex.: cliente novo agendou)
setInterval(async () => {
  if (!tokenBarb || $("telaBarbeiro").hidden) return;
  try { await recarregar(); render(); } catch (e) { if (e.status === 401) falhou(e); }
}, 60000);

// ================= Navegação =================
const ABAS_BARB = {
  inicio: ["🏠", "Início"],
  agenda: ["📅", "Minha agenda"],
  ganhos: ["💰", "Meus ganhos"],
  perfil: ["👤", "Meu perfil"],
  config: ["⚙️", "Configurações"],
};
function render() {
  $("navBarb").innerHTML = Object.entries(ABAS_BARB).map(([k, [ic, nome]]) =>
    `<button class="nav-item ${k === abaBarb ? "ativo" : ""}" data-aba="${k}"><span>${ic}</span>${nome}</button>`).join("");
  ({ inicio: renderInicioBarb, agenda: renderAgendaBarb, ganhos: renderGanhos, perfil: renderPerfil, config: renderConfigBarb })[abaBarb]();
}
$("navBarb").addEventListener("click", (e) => {
  const b = e.target.closest("[data-aba]");
  if (b) { abaBarb = b.dataset.aba; render(); window.scrollTo(0, 0); }
});
$("conteudoBarb").addEventListener("click", (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const acao = b.dataset.acao;
  if (acao === "irAba") { abaBarb = b.dataset.aba; render(); }
  if (acao === "diaAnt" || acao === "diaProx") {
    const d = dataDe(diaAgenda); d.setDate(d.getDate() + (acao === "diaAnt" ? -1 : 1)); diaAgenda = chaveDia(d); renderAgendaBarb();
  }
  if (acao === "hoje") { diaAgenda = hojeIso(); renderAgendaBarb(); }
  if (acao === "verDia") { diaAgenda = b.dataset.dia; renderAgendaBarb(); window.scrollTo(0, 0); }
});
$("conteudoBarb").addEventListener("change", (e) => {
  if (e.target.id === "escolheDia" && e.target.value) { diaAgenda = e.target.value; renderAgendaBarb(); }
  if (e.target.id === "escolheMes" && e.target.value) { mesGanhos = e.target.value; renderGanhos(); }
});

function linhaAtendimento(a, comData) {
  const situacao = {
    confirmado: `<span class="pg pix_aguardando">Agendado · você ganha ${real(a.comissaoPrevista)}</span>`,
    atendido: a.repasseId
      ? `<span class="pg pago">✓ Recebido em ${dataCurta(pagamentoDoRepasse(a.repasseId)?.data || a.dia)}</span>`
      : `<span class="pg pendente">A receber ${real(a.comissaoValor)}</span>`,
    faltou: `<span class="pg na_barbearia">Cliente faltou</span>`,
  }[a.status] || "";
  return `
    <div class="ag-linha st-${a.status}">
      <div class="ag-hora">${a.hora}${comData ? `<small>${dataCurta(a.dia)}</small>` : ""}</div>
      <div class="ag-info">
        <div><strong>${esc(a.cliente)}</strong> <span class="sub">· ${esc(a.servico)} (${a.duracao} min)</span></div>
        ${chipsProdutos(a)}
        ${a.obs ? `<p class="sub">📝 ${esc(a.obs)}</p>` : ""}
        <p class="sub">${situacao} ${a.telefone ? `· ${linkZap(a.telefone)}` : ""}</p>
      </div>
    </div>`;
}

// ================= Início =================
function renderInicioBarb() {
  const b = dados.barbeiro, ags = dados.agendamentos, hoje = hojeIso(), mes = hoje.slice(0, 7);
  const agHoje = ags.filter((a) => a.dia === hoje && a.status !== "faltou").sort(porHora);
  const feitosMes = ags.filter((a) => a.status === "atendido" && a.dia.startsWith(mes));
  const pendentes = ags.filter((a) => a.status === "atendido" && !a.repasseId);
  const agora = new Date();
  const proximo = ags.filter((a) => a.status === "confirmado" && new Date(`${a.dia}T${a.hora}`) >= new Date(agora.getTime() - 15 * 60000)).sort(porHora)[0];
  const folgaHoje = (b.folga || []).includes(agora.getDay());
  const entregar = agHoje.filter((a) => a.status === "confirmado" && a.produtos?.length);
  const h = agora.getHours();

  $("conteudoBarb").innerHTML = `
    <div class="cab">
      <div class="boas-vindas" style="margin:0">
        ${fotoOuInicial(b, "grande")}
        <div><p class="sub">${h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"} 💈</p><h1>Olá, ${esc(b.nome.split(" ")[0])}!</h1></div>
      </div>
      <p class="sub">${dataBonita(hoje)}${folgaHoje ? " · hoje é sua folga 🌴" : ""}</p>
    </div>

    <div class="indicadores">
      <div class="ind destaque"><span>Você tem a receber</span><strong>${real(dados.saldo)}</strong><small>${pendentes.length} atendimento(s) ainda não pagos</small></div>
      <div class="ind"><span>Ganhos no mês</span><strong>${real(soma(feitosMes, (a) => a.comissaoValor))}</strong><small>${feitosMes.length} atendimento(s)</small></div>
      <div class="ind"><span>Hoje</span><strong>${agHoje.filter((a) => a.status === "atendido").length} / ${agHoje.length}</strong><small>atendimentos feitos</small></div>
      <div class="ind"><span>Previsto para hoje</span><strong>${real(soma(agHoje, ganhoDe))}</strong><small>se todos vierem</small></div>
    </div>

    ${proximo ? `
    <div class="bloco cartao-proximo">
      <p class="rotulo">Seu próximo cliente</p>
      <div class="data-grande">
        <div class="dia-cal hora-cal"><strong>${proximo.hora}</strong><span>${proximo.dia === hoje ? "hoje" : dataCurta(proximo.dia)}</span></div>
        <div>
          <h3>${esc(proximo.cliente)}</h3>
          <p class="sub">${esc(proximo.servico)} · ${proximo.duracao} min · você ganha ${real(proximo.comissaoPrevista)} ${proximo.telefone ? "· " + linkZap(proximo.telefone) : ""}</p>
          ${proximo.obs ? `<p class="sub">📝 ${esc(proximo.obs)}</p>` : ""}
        </div>
      </div>
      ${proximo.produtos?.length ? `<p class="entrega">🎁 Entregar para o cliente:</p>${chipsProdutos(proximo)}` : ""}
    </div>` : ""}

    <div class="colunas">
      <div class="bloco">
        <h2>Sua agenda de hoje <button class="btn-peq" data-acao="irAba" data-aba="agenda">Ver agenda</button></h2>
        ${agHoje.length ? agHoje.map((a) => linhaAtendimento(a)).join("") : vazio(folgaHoje ? "Hoje é sua folga. Bom descanso!" : "Nenhum cliente marcado para hoje ainda.")}
      </div>
      <div>
        <div class="bloco">
          <h2>🎁 Produtos para entregar hoje</h2>
          ${entregar.length ? entregar.map((a) => `<div class="ag-linha"><div class="ag-hora">${a.hora}</div><div class="ag-info"><strong>${esc(a.cliente)}</strong>${chipsProdutos(a)}</div></div>`).join("")
            : vazio("Nenhum produto para entregar hoje.")}
        </div>
        <div class="bloco">
          <h2>Último pagamento <button class="btn-peq" data-acao="irAba" data-aba="ganhos">Ver ganhos</button></h2>
          ${dados.pagamentos[0] ? `<div class="saldo zerado"><span>${dataCurta(dados.pagamentos[0].data)} · ${esc(dados.pagamentos[0].forma)}</span><strong>${real(dados.pagamentos[0].valor)}</strong></div>`
            : vazio("Você ainda não recebeu nenhum pagamento.")}
        </div>
      </div>
    </div>`;
}

// ================= Agenda =================
function renderAgendaBarb() {
  const ags = dados.agendamentos;
  const doDia = ags.filter((a) => a.dia === diaAgenda).sort(porHora);
  const d = dataDe(diaAgenda);
  const cfg = FUNCIONAMENTO.semana[d.getDay()];
  const folga = (dados.barbeiro.folga || []).includes(d.getDay());
  const proximos = ags.filter((a) => a.status === "confirmado" && a.dia > hojeIso()).sort(porHora);
  const porDia = {};
  proximos.forEach((a) => { porDia[a.dia] = (porDia[a.dia] || 0) + 1; });

  $("conteudoBarb").innerHTML = `
    <div class="cab"><h1>Minha agenda</h1></div>
    <div class="filtros-ag">
      <button class="btn-peq" data-acao="diaAnt" aria-label="Dia anterior">‹</button>
      <input type="date" id="escolheDia" value="${diaAgenda}">
      <button class="btn-peq" data-acao="diaProx" aria-label="Próximo dia">›</button>
      <button class="btn-peq" data-acao="hoje">Hoje</button>
    </div>
    <div class="colunas">
      <div class="bloco">
        <h2><span>${dataBonita(diaAgenda)}</span>
          <span class="sub">${folga ? "sua folga" : lojaAbertaNoDia(d) ? `${cfg.abre}–${cfg.fecha}` : "barbearia fechada"}</span></h2>
        ${doDia.length ? doDia.map((a) => linhaAtendimento(a)).join("") : vazio("Nenhum cliente neste dia.")}
        ${doDia.length ? `<p class="sub" style="margin-top:10px">Neste dia: ${doDia.filter((a) => a.status !== "faltou").length} cliente(s) · ${real(soma(doDia, ganhoDe))} para você</p>` : ""}
      </div>
      <div class="bloco">
        <h2>Próximos dias</h2>
        ${Object.keys(porDia).length ? juntarVerMais("barbProximos", Object.entries(porDia).map(([dia, n]) => `
          <div class="ag-linha"><div class="ag-info"><strong>${dataBonita(dia)}</strong>
            <span class="sub">${n} cliente(s) · ${real(soma(proximos.filter((a) => a.dia === dia), ganhoDe))} previsto</span></div>
            <button class="btn-peq" data-acao="verDia" data-dia="${dia}">Ver</button></div>`), 5)
          : vazio("Nenhum agendamento nos próximos dias.")}
      </div>
    </div>`;
}

// ================= Ganhos =================
function renderGanhos() {
  const ags = dados.agendamentos.filter((a) => a.status === "atendido");
  const doMes = ags.filter((a) => a.dia.startsWith(mesGanhos)).sort((a, b) => porHora(b, a));
  const recebidoMes = doMes.filter((a) => a.repasseId);
  const pendentes = ags.filter((a) => !a.repasseId).sort(porHora);
  const nomeMes = dataDe(mesGanhos + "-01").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  // listas longas: mostra os primeiros e o resto fica no "Ver mais"
  const vmAtend = verMais("barbAtend", doMes.map((a) => `<tr>
            <td>${dataCurta(a.dia)}<br><span class="sub">${a.hora}</span></td>
            <td>${esc(a.servico)}<br><span class="sub">${esc(a.cliente)}</span></td>
            <td class="num">${real(a.total)}</td>
            <td class="num"><strong>${real(a.comissaoValor)}</strong></td>
            <td>${a.repasseId ? `<span class="pg pago">✓ Pago ${dataCurta(pagamentoDoRepasse(a.repasseId)?.data || a.dia)}</span>` : `<span class="pg pendente">A receber</span>`}</td>
          </tr>`), 8);

  $("conteudoBarb").innerHTML = `
    <div class="cab">
      <div><h1>Meus ganhos</h1><p class="sub" style="text-transform:capitalize">${nomeMes}</p></div>
      <div class="acoes"><input type="month" id="escolheMes" value="${mesGanhos}"></div>
    </div>

    <div class="indicadores">
      <div class="ind destaque"><span>A receber (total)</span><strong>${real(dados.saldo)}</strong><small>${pendentes.length} atendimento(s) ainda não pagos</small></div>
      <div class="ind"><span>Ganhos no mês</span><strong>${real(soma(doMes, (a) => a.comissaoValor))}</strong><small>${doMes.length} atendimento(s)</small></div>
      <div class="ind positivo"><span>Já recebido do mês</span><strong>${real(soma(recebidoMes, (a) => a.comissaoValor))}</strong></div>
      <div class="ind"><span>Sua comissão</span><strong>${dados.barbeiro.comissao}%</strong><small>serviços · ${dados.barbeiro.comissaoProdutos}% produtos</small></div>
    </div>

    <div class="colunas">
      <div class="bloco">
        <h2>Atendimentos do mês</h2>
        ${doMes.length ? `<div class="tabela-wrap"><table>
          <tr><th>Data</th><th>Atendimento</th><th class="num">Valor</th><th class="num">Você ganha</th><th>Situação</th></tr>
          ${vmAtend.itens}
        </table></div>${vmAtend.botao}` : vazio("Nenhum atendimento neste mês.")}
      </div>
      <div class="bloco">
        <h2>Pagamentos recebidos</h2>
        ${dados.pagamentos.length ? juntarVerMais("barbPagamentos", dados.pagamentos.map((p) => `
          <div class="ag-linha"><div class="ag-info"><strong>${real(p.valor)}</strong>
            <span class="sub">${dataCurta(p.data)} · ${esc(p.forma)} · ${dados.agendamentos.filter((a) => a.repasseId === p.id).length} atendimento(s)${p.obs ? ` · ${esc(p.obs)}` : ""}</span></div></div>`), 5)
          : vazio("Nenhum pagamento ainda.")}
      </div>
    </div>`;
}

// ================= Perfil =================
function renderPerfil() {
  const b = dados.barbeiro;
  $("conteudoBarb").innerHTML = `
    <div class="cab"><h1>Meu perfil</h1></div>
    <div class="colunas">
      <div class="bloco">
        <div class="foto-campo" style="border:none">
          ${fotoOuInicial(b, "enorme")}
          <h2 style="margin:0">${esc(b.nome)}</h2>
          <p class="sub">${esc(b.especialidade || "Barbeiro")}</p>
        </div>
        <div class="info-caixa" style="margin-top:14px">
          <span>📱 Login: <strong>${fmtTel(b.telefone)}</strong></span>
          <span>💈 Comissão: <strong>${b.comissao}%</strong> dos serviços e <strong>${b.comissaoProdutos}%</strong> dos produtos</span>
          <span>🌴 Folga: <strong>${(b.folga || []).length ? b.folga.map((i) => DIAS_SEMANA[i]).join(", ") : "nenhuma"}</strong></span>
          <span>⚡ Chave Pix para receber: <strong>${b.chavePix ? esc(b.chavePix) : "não cadastrada"}</strong></span>
          ${b.entrouEm ? `<span>📅 Na equipe desde ${dataBonita(b.entrouEm)}</span>` : ""}
        </div>
        <p class="sub" style="margin-top:10px">Para mudar foto, comissão, folga ou chave Pix, fale com o dono.</p>
      </div>
      <div class="bloco">
        <h2>Senha e e-mail</h2>
        <p class="sub" style="margin-bottom:12px">Para trocar a senha ou cadastrar um e-mail de recuperação, vá em Configurações.</p>
        <button class="btn-peq ouro" data-acao="irAba" data-aba="config">⚙️ Abrir configurações</button>
      </div>
    </div>`;
}

// ================= Configurações =================
function renderConfigBarb() {
  const b = dados.barbeiro;
  $("conteudoBarb").innerHTML = `<div class="cab"><h1>Configurações</h1></div><div id="configBarb"></div>`;
  desenharConfiguracoes($("configBarb"), {
    login: fmtTel(b.telefone), loginRotulo: "WhatsApp", loginBruto: b.telefone,
    dados: { email: b.email }, campos: ["email"], minimo: 4,
    salvarDados: async (d) => {
      try { await api("PUT", "/api/barbeiro/eu", d, tokenBarb); await recarregar(); avisar("E-mail salvo."); renderConfigBarb(); }
      catch (e) { falhou(e); }
    },
    trocarSenha: async (atual, nova) => {
      try { await api("POST", "/api/barbeiro/senha", { atual, nova }, tokenBarb); avisar("Senha trocada!"); }
      catch (e) { falhou(e); return false; }
    },
  });
}
document.addEventListener("barbearia:senha-recuperada", () => { if (tokenBarb) sairBarbeiro(); });

// ================= Início do app =================
mostrarTela("telaLoginBarbeiro");
if (tokenBarb) abrirPainel().catch((e) => { tokenBarb = null; salvar("tokenBarbeiro", null); if (e.status !== 401) avisar(e.message); });
