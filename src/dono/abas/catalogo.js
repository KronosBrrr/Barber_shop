// =====================================================================
//  ABA SERVIÇOS E PRODUTOS — preços, custos, margem e estoque
//  (usa as funções do núcleo: src/dono/dono.js)
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
