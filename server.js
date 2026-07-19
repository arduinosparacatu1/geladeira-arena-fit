// ============================================================
// Servidor - Geladeira Inteligente Arena Fit
// Arduinos Paracatu
// ------------------------------------------------------------
// Recebe o webhook da InfinitePay e libera a trava via ESP32.
// Deploy: Railway ou Render (plano gratuito).
//
// IMPORTANTE (conforme documentacao oficial da InfinitePay):
// A InfinitePay SO envia o webhook quando o pagamento e
// APROVADO. Nao existe campo "status" no corpo — a simples
// chegada do webhook ja significa pagamento confirmado.
// Formato recebido:
//   {
//     "invoice_slug": "abc123",
//     "amount": 1000,
//     "paid_amount": 1010,
//     "installments": 1,
//     "capture_method": "credit_card" (ou "pix"),
//     "transaction_nsu": "UUID",
//     "order_nsu": "UUID-do-pedido",
//     "receipt_url": "https://...",
//     "items": [...]
//   }
// Deve responder em menos de 1s com 200 OK.
// ============================================================

const express = require("express");
const app = express();

// Limite de corpo pequeno — o payload da InfinitePay e minusculo.
app.use(express.json({ limit: "100kb" }));

// ── Configuracao (variaveis de ambiente no Railway) ──────────
const PORT = process.env.PORT || 3000;

// Token secreto compartilhado entre o servidor e o ESP32.
// Defina em Railway → Variables → DEVICE_TOKEN
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "troque-este-token";

// ── Estado em memoria ────────────────────────────────────────
// A geladeira tem UMA porta. Qualquer pagamento aprovado libera.
let liberarPorta = false;

// Guarda os ultimos eventos para conferencia (nao essencial,
// mas ajuda no diagnostico). Mantem no maximo 20 registros.
let ultimoPagamento = null;
const historico = [];
function registrar(evento) {
  historico.unshift(evento);
  if (historico.length > 20) historico.pop();
}

// Evita processar o mesmo pagamento duas vezes caso a
// InfinitePay reenvie o webhook (idempotencia).
const idsProcessados = new Set();

// ── Webhook da InfinitePay ───────────────────────────────────
// Configure a URL abaixo no painel/checkout da InfinitePay:
//   https://SEU-APP.up.railway.app/webhook
app.post("/webhook", (req, res) => {
  const body = req.body || {};
  console.log("Webhook recebido:", JSON.stringify(body));

  // Identificador unico da transacao. Se ja processamos, ignora
  // mas ainda responde 200 (para a InfinitePay parar de reenviar).
  const idTransacao =
    body.transaction_nsu || body.invoice_slug || body.order_nsu || null;

  if (idTransacao && idsProcessados.has(idTransacao)) {
    console.log(">>> Webhook repetido, ignorado:", idTransacao);
    return res.sendStatus(200);
  }

  // Validacao minima: a InfinitePay so envia webhook em pagamento
  // aprovado. Confirmamos que o corpo tem a cara de um pagamento
  // (tem valor pago e algum identificador) antes de liberar.
  const pareceValido =
    (typeof body.paid_amount === "number" || typeof body.amount === "number") &&
    idTransacao !== null;

  if (pareceValido) {
    if (idTransacao) idsProcessados.add(idTransacao);
    liberarPorta = true;
    ultimoPagamento = {
      recebidoEm: new Date().toISOString(),
      valor: body.paid_amount || body.amount || null,
      metodo: body.capture_method || null,
      transacao: idTransacao,
    };
    registrar(ultimoPagamento);
    console.log(">>> Pagamento aprovado. Porta sera liberada.");
  } else {
    console.log(">>> Webhook ignorado (formato inesperado).");
  }

  // Responde rapido com 200 (exigencia da InfinitePay: < 1s).
  res.sendStatus(200);
});

// ── Endpoint consultado pelo ESP32 ───────────────────────────
// O ESP32 chama a cada 1,5s:
//   GET /status?token=SEU_TOKEN
// Resposta: { "abrir": true } uma unica vez apos o pagamento.
app.get("/status", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN) {
    return res.status(401).json({ erro: "token invalido" });
  }

  if (liberarPorta) {
    liberarPorta = false; // consome o evento — abre so uma vez
    console.log(">>> ESP32 notificado. Comando de abertura enviado.");
    return res.json({ abrir: true });
  }

  res.json({ abrir: false });
});

// ── Teste manual (simula um pagamento sem gastar) ────────────
//   https://SEU-APP.up.railway.app/teste?token=SEU_TOKEN
app.get("/teste", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN) {
    return res.status(401).send("token invalido");
  }
  liberarPorta = true;
  console.log(">>> TESTE: porta marcada para abrir.");
  res.send("OK - a porta sera liberada no proximo ciclo do ESP32 (ate 1,5s)");
});

// ── Health check / diagnostico ───────────────────────────────
app.get("/", (req, res) => {
  res.json({
    servico: "geladeira-inteligente",
    status: "online",
    portaAguardandoAbertura: liberarPorta,
    ultimoPagamento,
    totalEventos: historico.length,
  });
});

// ── Ver historico (protegido por token) ──────────────────────
app.get("/historico", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN) {
    return res.status(401).json({ erro: "token invalido" });
  }
  res.json({ historico });
});

// ── Tratamento de rota inexistente ───────────────────────────
app.use((req, res) => {
  res.status(404).json({ erro: "rota nao encontrada" });
});

// ── Tratamento de erro (ex: JSON malformado no webhook) ──────
// Sem isso, um corpo invalido derruba a resposta e a InfinitePay
// reenvia em loop. Respondemos 200 para encerrar com seguranca.
app.use((err, req, res, next) => {
  console.error("Erro ao processar requisicao:", err.message);
  if (req.path === "/webhook") {
    return res.sendStatus(200);
  }
  res.status(400).json({ erro: "requisicao invalida" });
});

app.listen(PORT, () => {
  console.log(`Servidor da geladeira rodando na porta ${PORT}`);
});
