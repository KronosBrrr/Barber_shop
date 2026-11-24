// =====================================================================
//  ABA CLIENTES — histórico e quem está sumido
//  (usa as funções do núcleo: src/dono/dono.js)
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
  // com busca, mostra tudo; sem busca, os 10 primeiros e o resto no "Ver mais"
  const vm = verMais(b ? "clientesBusca" : "clientes", lista.map((c) => linhaCliente(c)), b ? 1000 : 10);
  $("listaCli").innerHTML = lista.length ? `<table>
    <tr><th>Cliente</th><th class="num">Visitas</th><th class="num">Gastou</th><th>Última visita</th><th>Próximo horário</th></tr>
    ${vm.itens}
  </table>${vm.botao}` : vazio("Nenhum cliente encontrado.");
}

function linhaCliente(c) {
  const sumido = c.ultima && !c.proxima && diasDesde(c.ultima) > 30;
  return `<tr>
    <td><strong>${esc(c.nome)}</strong><br><span class="sub">${fmtTel(c.tel)} ${linkZap(c.tel)}${c.faltas ? ` · ${c.faltas} falta(s)` : ""}</span></td>
    <td class="num">${c.visitas}</td><td class="num">${real(c.gasto)}</td>
    <td>${c.ultima ? `${dataCurta(c.ultima)}${sumido ? `<br><span class="sub" style="color:var(--perigo)">há ${diasDesde(c.ultima)} dias</span>` : ""}` : "—"}</td>
    <td>${c.proxima ? `${dataCurta(c.proxima.slice(0, 10))} às ${c.proxima.slice(11)}` : "—"}</td></tr>`;
}
DIGITAR.buscaCli = (el) => { buscaCli = el.value; preencherClientes(); };
