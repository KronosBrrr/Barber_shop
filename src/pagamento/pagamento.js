// =====================================================================
//  PAGAMENTO — Pix (QR code, confirmado sozinho com o Mercado Pago) e cartão.
// =====================================================================

// ================= Pagamento (Pix e cartão) =================
// O número de parcelas vem do banco (o dono escolhe em Funcionamento → Pagamentos)
const formasPagamento = () => {
  const vezes = CONFIG.pagamentos?.maxParcelas || 1;
  return [
    ["Pix", "⚡", "Pix", "QR code na hora"],
    ["Cartão de crédito", "💳", "Crédito", vezes > 1 ? `em até ${vezes}x sem juros` : "à vista"],
    ["Cartão de débito", "💳", "Débito", "à vista"],
    ["Pagar na barbearia", "🏪", "Na barbearia", "no dia do atendimento"],
  ];
};
const metodoDe = (forma) => (forma === "Cartão de crédito" ? "credito" : forma === "Cartão de débito" ? "debito" : "pix");
const textoConfirmar = () => (pedido?.pagamento === "Pagar na barbearia" ? "Confirmar agendamento" : "Confirmar e pagar");

let pagando = null;   // agendamento que está sendo pago
let metodoPag = "pix";

function abrirPagamento(a, metodo) {
  pagando = a;
  const pixOk = CONFIG.pagamentos?.pixAtivo !== false;
  if (metodo === "pix" && !pixOk) metodo = "credito";
  $("pagResumo").textContent = `${a.servico} com ${a.barbeiro} · ${dataCurta(a.dia)} às ${a.hora}`;
  $("pagValor").textContent = real(a.total);
  $("abasPag").querySelector('[data-metodo="pix"]').hidden = !pixOk;
  $("avisoTeste").hidden = CONFIG.pagamentos?.modoCartao !== "teste";
  const max = CONFIG.pagamentos?.maxParcelas || 1;
  $("cartaoParcelas").innerHTML = Array.from({ length: max }, (_, i) =>
    `<option value="${i + 1}">${i + 1}x de ${real(a.total / (i + 1))}${i ? " sem juros" : " (à vista)"}</option>`).join("");
  $("formCartao").reset();
  $("erroCartao").textContent = "";
  $("pagEmail").value = usuario?.email || "";
  $("pagCpf").value = usuario?.cpf || "";
  if (comMercadoPago()) carregarSdkMercadoPago();
  atualizarCartaoVisual();
  mostrarTela("telaPagamento");
  escolherMetodo(metodo);
}

const comMercadoPago = () => CONFIG.pagamentos?.modoCartao === "mercadopago";

function escolherMetodo(m) {
  metodoPag = m;
  pararEsperaPix();
  $("abasPag").querySelectorAll("[data-metodo]").forEach((b) => b.classList.toggle("ativo", b.dataset.metodo === m));
  $("painelPix").hidden = m !== "pix";
  $("formCartao").hidden = m === "pix";
  $("campoParcelas").hidden = m !== "credito";
  $("btnPagarCartao").textContent = `Pagar ${real(pagando.total)}`;
  // o Mercado Pago pede e-mail (e CPF no cartão)
  $("dadosPagador").hidden = !comMercadoPago();
  $("campoCpf").hidden = m === "pix";
  if (m === "pix") {
    const precisaEmail = comMercadoPago() && !usuario?.email;
    $("btnGerarPix").hidden = !precisaEmail;
    if (precisaEmail) {
      $("qrPix").hidden = true;
      $("aguardandoPix").hidden = true;
    } else gerarPix();
  }
}
$("btnGerarPix").addEventListener("click", () => { $("btnGerarPix").hidden = true; gerarPix(); });

// ---- Pix automático (Mercado Pago): pergunta ao servidor de tempos em tempos se o Pix caiu
let esperaPix = null;
function pararEsperaPix() { clearInterval(esperaPix); esperaPix = null; }
function esperarPix() {
  pararEsperaPix();
  const a = pagando;
  esperaPix = setInterval(async () => {
    if ($("telaPagamento").hidden || pagando !== a) return pararEsperaPix();
    try {
      const r = await api("GET", `/api/agendamentos/${a.id}/pagamento`, undefined, token);
      if (r.pago) {
        pararEsperaPix();
        await carregarMeusDados().catch(() => {});
        mostrarSucesso(a, "Pix recebido!", `<p class="sub">✓ Recebemos ${real(a.total)} pelo Mercado Pago. Seu pedido está pago.</p>`);
      }
    } catch (e) { if (e.status === 401) { pararEsperaPix(); tratarErro(e); } }
  }, 4000);
}

// ---- Biblioteca do Mercado Pago (só é baixada quando ele está ligado)
let sdkMercadoPago = null;
function carregarSdkMercadoPago() {
  if (sdkMercadoPago) return sdkMercadoPago;
  sdkMercadoPago = new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = "https://sdk.mercadopago.com/js/v2";
    s.onload = () => ok(new window.MercadoPago(CONFIG.pagamentos.mpPublicKey, { locale: "pt-BR" }));
    s.onerror = () => { sdkMercadoPago = null; falha(new Error("Não foi possível carregar o Mercado Pago. Verifique a internet.")); };
    document.head.appendChild(s);
  });
  return sdkMercadoPago;
}
$("abasPag").addEventListener("click", (e) => {
  const b = e.target.closest("[data-metodo]");
  if (b) escolherMetodo(b.dataset.metodo);
});

async function gerarPix() {
  $("qrPix").hidden = false;
  $("qrPix").innerHTML = `<span class="sub">Gerando QR code...</span>`;
  $("pixCodigo").value = "";
  try {
    const r = await api("POST", `/api/agendamentos/${pagando.id}/pix`, { email: $("pagEmail").value.trim() }, token);
    if (comMercadoPago() && usuario && $("pagEmail").value.trim()) usuario.email = $("pagEmail").value.trim();
    $("pixCodigo").value = r.codigo;
    $("pixRecebedor").textContent = r.recebedor;
    $("btnJaPaguei").hidden = !!r.automatico;      // com Mercado Pago a confirmação é automática
    $("aguardandoPix").hidden = !r.automatico;
    if (r.automatico) esperarPix();
    if (r.qrBase64) {
      $("qrPix").innerHTML = `<img src="data:image/png;base64,${r.qrBase64}" alt="QR code do Pix">`;
    } else if (window.qrcode) {
      const q = qrcode(0, "M");
      q.addData(r.codigo);
      q.make();
      $("qrPix").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } else {
      $("qrPix").innerHTML = `<span style="color:#333;font-size:.85rem;text-align:center">Sem internet para desenhar o QR code.<br>Use o Pix copia e cola abaixo.</span>`;
    }
  } catch (e) {
    $("qrPix").innerHTML = "";
    if (comMercadoPago() && e.status === 400) $("btnGerarPix").hidden = false;  // ex.: e-mail inválido
    tratarErro(e);
  }
}

$("btnCopiarPix").addEventListener("click", async () => {
  const campo = $("pixCodigo");
  try { await navigator.clipboard.writeText(campo.value); }
  catch { campo.select(); document.execCommand("copy"); }
  avisar("Código Pix copiado!");
});

$("btnJaPaguei").addEventListener("click", async () => {
  const a = pagando;
  await carregarMeusDados().catch(() => {});
  mostrarSucesso(a, "Pix enviado!", `<p class="sub">Assim que a barbearia confirmar o recebimento de ${real(a.total)}, seu pedido aparece como <strong>pago</strong>.</p>`);
});

async function sairDoPagamento() {
  pararEsperaPix();
  await carregarMeusDados().catch(() => {});
  renderInicio();
  mostrarTela("telaInicio");
  avisar("Seu horário está reservado. Você pode pagar depois em “Seus pedidos”.");
}
$("btnPagarDepois").addEventListener("click", sairDoPagamento);
$("btnFecharPagamento").addEventListener("click", sairDoPagamento);

// ---- Cartão: formatação e desenho do cartão
function bandeiraDe(n) {
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(n)) return "ELO";
  if (/^(606282|3841)/.test(n)) return "HIPERCARD";
  if (/^3[47]/.test(n)) return "AMEX";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return "MASTERCARD";
  if (/^4/.test(n)) return "VISA";
  return "CARTÃO";
}
function atualizarCartaoVisual() {
  const n = soDigitos($("cartaoNumero").value);
  $("cvNumero").textContent = (n.padEnd(16, "•").match(/.{1,4}/g) || []).join(" ");
  $("cvNome").textContent = $("cartaoNome").value.trim().toUpperCase() || "SEU NOME";
  $("cvValidade").textContent = $("cartaoValidade").value || "MM/AA";
  $("cvBandeira").textContent = bandeiraDe(n);
}
$("cartaoNumero").addEventListener("input", (e) => {
  e.target.value = soDigitos(e.target.value).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
  atualizarCartaoVisual();
});
$("cartaoValidade").addEventListener("input", (e) => {
  const d = soDigitos(e.target.value).slice(0, 4);
  e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  atualizarCartaoVisual();
});
$("cartaoCvv").addEventListener("input", (e) => (e.target.value = soDigitos(e.target.value).slice(0, 4)));
$("cartaoNome").addEventListener("input", atualizarCartaoVisual);

$("formCartao").addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = $("btnPagarCartao");
  botao.disabled = true;
  botao.textContent = "Processando...";
  $("erroCartao").textContent = "";
  try {
    const parcelas = metodoPag === "credito" ? Number($("cartaoParcelas").value) || 1 : 1;
    let corpo;
    if (comMercadoPago()) {
      // Os dados do cartão vão direto para o Mercado Pago, que devolve um "token".
      // Nosso servidor recebe só o token: nunca vê o número do cartão.
      const mp = await carregarSdkMercadoPago();
      const numero = soDigitos($("cartaoNumero").value);
      const [mes, ano] = $("cartaoValidade").value.split("/");
      const cpf = soDigitos($("pagCpf").value);
      if (cpf.length !== 11) throw new Error("Digite o CPF do dono do cartão.");
      const metodos = (await mp.getPaymentMethods({ bin: numero.slice(0, 8) })).results || [];
      const tipoMP = metodoPag === "debito" ? "debit_card" : "credit_card";
      const m = metodos.find((x) => x.payment_type_id === tipoMP) || metodos[0];
      if (!m) throw new Error("Cartão não reconhecido. Confira o número.");
      let tokenCartao;
      try {
        tokenCartao = await mp.createCardToken({
          cardNumber: numero, cardholderName: $("cartaoNome").value.trim(),
          cardExpirationMonth: mes, cardExpirationYear: ano?.length === 2 ? "20" + ano : ano,
          securityCode: $("cartaoCvv").value, identificationType: "CPF", identificationNumber: cpf,
        });
      } catch { throw new Error("Confira os dados do cartão (número, validade e CVV)."); }
      corpo = { tipo: metodoPag, parcelas, token: tokenCartao.id, metodoId: m.id, emissorId: m.issuer?.id,
        bandeira: m.name, final: numero.slice(-4), email: $("pagEmail").value.trim(), cpf };
    } else {
      corpo = { tipo: metodoPag, parcelas, numero: $("cartaoNumero").value, nome: $("cartaoNome").value,
        validade: $("cartaoValidade").value, cvv: $("cartaoCvv").value };
    }
    const r = await api("POST", `/api/agendamentos/${pagando.id}/cartao`, corpo, token);
    if (!r.aprovado) { $("erroCartao").textContent = r.mensagem; return; }
    const a = pagando;
    $("formCartao").reset();
    await carregarMeusDados().catch(() => {});
    mostrarSucesso(a, "Pagamento aprovado!", `
      <p class="sub">💳 ${esc(r.bandeira)} final ${esc(r.final)}${r.parcelas > 1 ? ` · ${r.parcelas}x de ${real(a.total / r.parcelas)}` : ""} · ${real(a.total)}</p>
      ${r.modoTeste ? `<p class="aviso-teste">🧪 Modo de teste: nada foi cobrado de verdade.</p>` : ""}`);
  } catch (er) {
    if (er.status === 401) tratarErro(er);
    else $("erroCartao").textContent = er.message;
  } finally {
    botao.disabled = false;
    botao.textContent = `Pagar ${real(pagando.total)}`;
  }
});
