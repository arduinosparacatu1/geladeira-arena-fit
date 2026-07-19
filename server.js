// ============================================================
// Servidor - Geladeira Inteligente Arena Fit
// Arduinos Paracatu
// ============================================================

const express = require("express");
const app = express();
app.use(express.json({ limit: "100kb" }));

const PORT         = process.env.PORT || 3000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "troque-este-token";
const HANDLE       = process.env.INFINITEPAY_HANDLE || "alan_goncalve";
const WEBHOOK_URL  = process.env.WEBHOOK_URL || "";

// ── Catalogo de produtos ─────────────────────────────────────
const PRODUTOS = [
  { id: "monster",       nome: "Monster",               preco: 1200 },
  { id: "baly",          nome: "Baly",                  preco: 1000 },
  { id: "redbull355",    nome: "Red Bull 355ml",        preco: 1700 },
  { id: "redbull473",    nome: "Red Bull 473ml",        preco: 2000 },
  { id: "aguagas",       nome: "Agua com Gas",          preco:  500 },
  { id: "aguasemgas",    nome: "Agua sem Gas",          preco:  400 },
  { id: "agua1l",        nome: "Agua 1 Litro",          preco:  700 },
  { id: "gatorade",      nome: "Gatorade",              preco:  800 },
  { id: "powerade",      nome: "Powerade",              preco:  700 },
  { id: "coca",          nome: "Coca-Cola",             preco:  600 },
  { id: "wepink",        nome: "WePink",                preco:  800 },
  { id: "carbup",        nome: "CarbUp",                preco:  690 },
  { id: "barrinha-ovo",  nome: "Barrinha Ovo Maltine",  preco: 1200 },
  { id: "barrinha-grow", nome: "Barrinha Growth",       preco:  900 },
  { id: "chiclete",      nome: "Chiclete Mentos",       preco:   50 },
  { id: "whey-sache",    nome: "Whey Sache Growth",     preco: 1000 },
  { id: "whey-isolado",  nome: "Whey Sache Isolado",    preco: 1500 },
];

// ── Estado ───────────────────────────────────────────────────
let liberarPorta  = false;
let ultimoPagamento = null;
const historico   = [];
const idsProcessados = new Set();

function registrar(ev) {
  historico.unshift(ev);
  if (historico.length > 20) historico.pop();
}

// ── Catalogo HTML (pagina que o QR Code abre) ────────────────
app.get("/catalogo", (req, res) => {
  const itens = PRODUTOS.map(p => `
    <a href="/pagar/${p.id}" class="card">
      <span class="nome">${p.nome}</span>
      <span class="preco">R$ ${(p.preco / 100).toFixed(2).replace(".", ",")}</span>
    </a>`).join("");

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Arena Fit — Geladeira</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #fff; min-height: 100vh; }
    header { background: #F5C300; padding: 18px 20px; text-align: center; }
    header h1 { font-size: 22px; color: #000; font-weight: 700; }
    header p  { font-size: 13px; color: #333; margin-top: 3px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px; }
    .card { background: #1a1a1a; border-radius: 12px; padding: 18px 12px;
            text-decoration: none; color: #fff; display: flex; flex-direction: column;
            align-items: center; gap: 8px; border: 1.5px solid #2a2a2a;
            transition: border-color 0.15s; active: border-color #F5C300; }
    .card:active { border-color: #F5C300; background: #222; }
    .nome  { font-size: 15px; font-weight: 600; text-align: center; }
    .preco { font-size: 20px; font-weight: 700; color: #F5C300; }
    footer { text-align: center; padding: 20px; font-size: 12px; color: #555; }
  </style>
</head>
<body>
  <header>
    <h1>AS Fitness Suplementos</h1>
    <p>Escolha seu produto e pague pelo celular</p>
  </header>
  <div class="grid">${itens}</div>
  <footer>AS Fitness Suplementos • Pagamento seguro via InfinitePay</footer>
</body>
</html>`);
});

// ── Gera link InfinitePay e redireciona o cliente ────────────
app.get("/pagar/:id", async (req, res) => {
  const produto = PRODUTOS.find(p => p.id === req.params.id);
  if (!produto) return res.status(404).send("Produto nao encontrado");

  const webhookUrl = WEBHOOK_URL ||
    `${req.protocol}://${req.get("host")}/webhook`;

  const nsu = `${produto.id}-${Date.now()}`;

  try {
    const r = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle:      HANDLE,
        webhook_url: webhookUrl,
        order_nsu:   nsu,
        items: [{
          quantity:    1,
          price:       produto.preco,
          description: `${produto.nome} - Arena Fit`,
        }],
      }),
    });

    const data = await r.json();
    if (data.url) {
      return res.redirect(data.url);
    }
    console.error("Erro InfinitePay:", data);
    res.status(500).send("Erro ao gerar link de pagamento. Tente novamente.");
  } catch (err) {
    console.error("Falha na requisicao:", err.message);
    res.status(500).send("Erro de conexao. Tente novamente.");
  }
});

// ── Webhook da InfinitePay ───────────────────────────────────
app.post("/webhook", (req, res) => {
  const body = req.body || {};
  console.log("Webhook recebido:", JSON.stringify(body));

  const idTransacao =
    body.transaction_nsu || body.invoice_slug || body.order_nsu || null;

  if (idTransacao && idsProcessados.has(idTransacao)) {
    console.log(">>> Webhook repetido, ignorado:", idTransacao);
    return res.sendStatus(200);
  }

  const pareceValido =
    (typeof body.paid_amount === "number" || typeof body.amount === "number") &&
    idTransacao !== null;

  if (pareceValido) {
    if (idTransacao) idsProcessados.add(idTransacao);
    liberarPorta = true;
    ultimoPagamento = {
      recebidoEm: new Date().toISOString(),
      valor:      body.paid_amount || body.amount || null,
      metodo:     body.capture_method || null,
      transacao:  idTransacao,
    };
    registrar(ultimoPagamento);
    console.log(">>> Pagamento aprovado. Porta sera liberada.");
  } else {
    console.log(">>> Webhook ignorado (formato inesperado).");
  }

  res.sendStatus(200);
});

// ── ESP32: consulta se deve abrir ────────────────────────────
app.get("/status", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN)
    return res.status(401).json({ erro: "token invalido" });

  if (liberarPorta) {
    liberarPorta = false;
    console.log(">>> ESP32 notificado. Abrindo porta.");
    return res.json({ abrir: true });
  }
  res.json({ abrir: false });
});

// ── Teste manual ─────────────────────────────────────────────
app.get("/teste", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN)
    return res.status(401).send("token invalido");
  liberarPorta = true;
  res.send("OK - porta sera liberada no proximo ciclo do ESP32");
});

// ── Health / diagnostico ─────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    servico: "geladeira-inteligente",
    status:  "online",
    catalogo: "/catalogo",
    portaAguardandoAbertura: liberarPorta,
    ultimoPagamento,
    totalEventos: historico.length,
  });
});

app.get("/historico", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN)
    return res.status(401).json({ erro: "token invalido" });
  res.json({ historico });
});

app.use((req, res) => res.status(404).json({ erro: "rota nao encontrada" }));

app.use((err, req, res, next) => {
  console.error("Erro:", err.message);
  if (req.path === "/webhook") return res.sendStatus(200);
  res.status(400).json({ erro: "requisicao invalida" });
});

app.listen(PORT, () =>
  console.log(`Servidor geladeira rodando na porta ${PORT}`)
);
