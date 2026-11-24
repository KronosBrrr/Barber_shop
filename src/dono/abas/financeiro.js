// =====================================================================
//  ABA FINANCEIRO — receita, comissões, despesas e lucro por mês
//  (usa as funções do núcleo: src/dono/dono.js)
// =====================================================================

let fMes = mesAtual();

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
            ${verMais("despesas", despMes.map((d) => `<tr><td>${dataCurta(d.data)}</td><td>${esc(d.descricao)}<br><span class="sub">${esc(d.categoria)}</span></td>
              <td class="num">${real(d.valor)}</td><td class="num"><button class="btn-peq vermelho" data-acao="excluirDesp" data-id="${d.id}">Excluir</button></td></tr>`), 6).itens}
          </table></div>${verMais("despesas", despMes, 6).botao}` : vazio("Nenhuma despesa lançada neste mês. Lance aluguel, luz, água etc. para o lucro ficar certo.")}
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
          ${pagMes.length ? juntarVerMais("pagMes", pagMes.map((p) => `<div class="ag-linha"><div class="ag-info"><strong>${esc(p.barbeiro)}</strong><span class="sub">${dataCurta(p.data)} · ${esc(p.forma)}</span></div><strong>${real(p.valor)}</strong></div>`), 5)
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
      <label>Categoria<input name="categoria" list="listaCatDesp" required placeholder="Escolha ou digite uma nova">
        <datalist id="listaCatDesp">${OPCOES.categoriasDespesa.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
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
