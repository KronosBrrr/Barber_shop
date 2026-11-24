// =====================================================================
//  ABA PAINEL — resumo do dia, lucro do mês e alertas
//  (usa as funções do núcleo: src/dono/dono.js)
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
        <h1>${["Boa noite", "Bom dia", "Boa tarde", "Boa noite"][Math.floor(new Date().getHours() / 6)]}! 💈</h1>
        <p class="sub">${dataBonita(hoje)} · ${lojaAbertaNoDia(new Date()) ? `aberto das ${cfgHoje.abre} às ${cfgHoje.fecha}` : "barbearia fechada hoje"}</p>
      </div>
      <div class="acoes"><button class="btn-peq ouro" data-acao="novoAg">+ Agendamento no balcão</button></div>
    </div>

    ${pend.length ? `<div class="alerta"><span>⏳ <strong>${pend.length}</strong> atendimento(s) já passaram e ainda não foram marcados como atendido ou falta.</span><button class="btn-peq ouro" data-acao="verPendentes">Resolver</button></div>` : ""}
    ${fora.length ? `<div class="alerta vermelho"><span>⚠ <strong>${fora.length}</strong> agendamento(s) caem em dia fechado, folga do barbeiro ou fora do horário. Troque o barbeiro ou avise o cliente.</span><button class="btn-peq" data-acao="verFora">Ver</button></div>` : ""}
    ${agendamentos.some((a) => a.reembolsoPendente) ? `<div class="alerta vermelho"><span>💸 <strong>${agendamentos.filter((a) => a.reembolsoPendente).length}</strong> pedido(s) cancelado(s) ainda precisam devolver o dinheiro ao cliente.</span><button class="btn-peq ouro" data-acao="verReembolsos">Ver</button></div>` : ""}
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
            return `<div class="ag-linha">${fotoOuInicial(b)}
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
ACOES.verReembolsos = () => { fAg = { dia: "", barbeiro: "todos", status: "reembolso" }; abaAtual = "agenda"; renderAba(); };
ACOES.verFora = () => { fAg = { dia: "", barbeiro: "todos", status: "fora" }; abaAtual = "agenda"; renderAba(); };
