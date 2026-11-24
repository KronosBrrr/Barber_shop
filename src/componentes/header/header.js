// =====================================================================
//  HEADER — menu ☰ no celular e altura do cabeçalho
// =====================================================================
(() => {
  const topo = document.getElementById("topoSite");
  if (!topo) return;
  const nav = document.getElementById("navTopo");
  const botao = document.getElementById("btnMenu");

  // Links para seções (#servicos, #equipe...) que não existem nesta página somem do menu
  nav.querySelectorAll('a[href^="#"]').forEach((a) => {
    if (a.getAttribute("href").length > 1 && !document.querySelector(a.getAttribute("href"))) a.hidden = true;
  });

  // O ☰ só aparece se o menu tiver algum link visível
  const temLinks = () => [...nav.children].some((x) => !x.hidden);
  const atualizar = () => topo.classList.toggle("tem-menu", temLinks());
  atualizar();
  new MutationObserver(atualizar).observe(nav, { subtree: true, attributes: true, attributeFilter: ["hidden"], childList: true });

  const fechar = () => { topo.classList.remove("aberto"); botao.setAttribute("aria-expanded", "false"); };
  botao.addEventListener("click", () => {
    const aberto = topo.classList.toggle("aberto");
    botao.setAttribute("aria-expanded", String(aberto));
  });
  nav.addEventListener("click", (e) => { if (e.target.closest("a, button")) fechar(); });

  // Altura do header em uma variável CSS (o menu lateral do painel fica logo abaixo dele)
  const medir = () => document.documentElement.style.setProperty("--altura-topo", topo.offsetHeight + "px");
  medir();
  if (window.ResizeObserver) new ResizeObserver(medir).observe(topo);
})();
