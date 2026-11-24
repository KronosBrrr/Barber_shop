// =====================================================================
//  PÁGINA INICIAL — desenha as partes que são listas no banco:
//  cartões do topo, números, diferenciais, passos e vantagens.
//  (Os títulos e textos já vêm prontos do servidor, com {{site.*}} no HTML.)
// =====================================================================

function desenharPaginaInicial() {
  const itens = CONFIG.site.itens || {};
  const textos = CONFIG.site.textos || {};

  $("heroCartoes").innerHTML = (itens.destaque || []).slice(0, 3).map((x, i) =>
    `<div class="hero-cartao c${i + 1}">${esc(x.icone)} ${esc(x.texto)}</div>`).join("");

  const menor = SERVICOS.length ? Math.min(...SERVICOS.map((s) => s.preco)) : 0;
  $("homeNumeros").innerHTML = [
    [BARBEIROS.length, "barbeiros especialistas"],
    [SERVICOS.length, "serviços para você"],
    [menor ? real(menor) : "—", "a partir de"],
    [textos.tempo_agendar || "—", "para agendar"],
  ].map(([n, t]) => `<div><strong>${esc(n)}</strong><span>${t}</span></div>`).join("");

  $("homeDiferenciais").innerHTML = (itens.diferencial || []).map((x) =>
    `<div class="card-home"><span class="icone">${esc(x.icone)}</span><h3>${esc(x.titulo)}</h3><p>${esc(x.texto)}</p></div>`).join("");

  $("homePassos").innerHTML = (itens.passo || []).map((x, i) =>
    `<div class="passo-home"><span class="num-home">${i + 1}</span><h3>${esc(x.titulo)}</h3><p>${esc(x.texto)}</p></div>`).join("");

  $("homeVantagens").innerHTML = (itens.vantagem || []).map((x) => `<li>✓ ${esc(x.texto)}</li>`).join("");
}
quandoConfig(desenharPaginaInicial);

// Cliente já entrou neste aparelho? O botão "Entrar" do topo vira "Olá, Nome"
(async () => {
  const token = ler("tokenCliente", null);
  const botao = $("btnEntrarTopo");
  if (!token || !botao) return;
  try {
    const d = await api("GET", "/api/clientes/eu", undefined, token);
    botao.textContent = `Olá, ${d.cliente.nome.split(" ")[0]}`;
  } catch (e) {
    if (e.status === 401) salvar("tokenCliente", null);
  }
})();
