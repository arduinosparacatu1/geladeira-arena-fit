// ============================================================
// Servidor - Geladeira Inteligente AS Fitness Suplementos
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
  { id: "chiclete",      nome: "Chiclete Mentos",       preco:  100 },
  { id: "whey-sache",    nome: "Whey Sache Growth",     preco: 1000 },
  { id: "whey-isolado",  nome: "Whey Sache Isolado",    preco: 1500 },
];

// ── Estado ───────────────────────────────────────────────────
let liberarPorta    = false;
let ultimoPagamento = null;
const historico     = [];
const idsProcessados = new Set();

function registrar(ev) {
  historico.unshift(ev);
  if (historico.length > 20) historico.pop();
}

// ── Catalogo HTML com carrinho ────────────────────────────────
app.get("/catalogo", (req, res) => {
  const itens = PRODUTOS.map(p => `
    <div class="card" data-id="${p.id}">
      <div class="info">
        <span class="nome">${p.nome}</span>
        <span class="preco">R$ ${(p.preco / 100).toFixed(2).replace(".", ",")}</span>
      </div>
      <div class="qty-ctrl">
        <button class="btn-minus" onclick="mudar('${p.id}',-1)">−</button>
        <span class="qty" id="qty-${p.id}">0</span>
        <button class="btn-plus" onclick="mudar('${p.id}',1)">+</button>
      </div>
    </div>`).join("");

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AS Fitness Suplementos</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #fff; padding-bottom: 110px; }
    header { background: #F5C300; padding: 16px 20px; text-align: center; }
    header h1 { font-size: 20px; color: #000; font-weight: 700; }
    header p  { font-size: 13px; color: #333; margin-top: 2px; }
    .lista { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
    .card { background: #1a1a1a; border-radius: 12px; padding: 14px 16px;
            display: flex; justify-content: space-between; align-items: center;
            border: 1.5px solid #2a2a2a; }
    .card.ativo { border-color: #F5C300; }
    .info { display: flex; flex-direction: column; gap: 3px; }
    .nome  { font-size: 15px; font-weight: 600; }
    .preco { font-size: 13px; color: #aaa; }
    .qty-ctrl { display: flex; align-items: center; gap: 12px; }
    .btn-minus, .btn-plus { width: 34px; height: 34px; border-radius: 50%;
      border: none; font-size: 22px; font-weight: 700; cursor: pointer;
      display: flex; align-items: center; justify-content: center; }
    .btn-minus { background: #333; color: #fff; }
    .btn-plus  { background: #F5C300; color: #000; }
    .qty { font-size: 18px; font-weight: 700; min-width: 24px; text-align: center; }
    .carrinho { position: fixed; bottom: 0; left: 0; right: 0;
                background: #111; border-top: 1px solid #222;
                padding: 14px 16px; display: none; flex-direction: column; gap: 10px; }
    .carrinho.visivel { display: flex; }
    .resumo { display: flex; justify-content: space-between; align-items: center; }
    .resumo span { font-size: 14px; color: #aaa; }
    .resumo strong { font-size: 20px; color: #F5C300; }
    .btn-pagar { background: #F5C300; color: #000; border: none; border-radius: 12px;
                 padding: 16px; font-size: 17px; font-weight: 700; cursor: pointer; width: 100%; }
  </style>
</head>
<body>
  <header>
    <h1>AS Fitness Suplementos</h1>
    <p>Escolha seus produtos e pague pelo celular</p>
  </header>
  <div class="lista">${itens}</div>

  <div class="carrinho" id="carrinho">
    <div class="resumo">
      <span id="resumo-itens">0 itens</span>
      <strong id="resumo-total">R$ 0,00</strong>
    </div>
    <button class="btn-pagar" onclick="pagar()">Pagar agora →</button>
  </div>

  <script>
    const PRODUTOS = ${JSON.stringify(PRODUTOS)};
    const qtds = {};
    PRODUTOS.forEach(p => qtds[p.id] = 0);

    function mudar(id, delta) {
      qtds[id] = Math.max(0, (qtds[id] || 0) + delta);
      document.getElementById('qty-' + id).textContent = qtds[id];
      document.querySelector('[data-id="' + id + '"]').classList.toggle('ativo', qtds[id] > 0);
      atualizarCarrinho();
    }

    function atualizarCarrinho() {
      let total = 0, itens = 0;
      PRODUTOS.forEach(p => { total += (qtds[p.id]||0) * p.preco; itens += qtds[p.id]||0; });
      const carr = document.getElementById('carrinho');
      if (itens > 0) {
        carr.classList.add('visivel');
        document.getElementById('resumo-itens').textContent = itens + (itens === 1 ? ' item' : ' itens');
        document.getElementById('resumo-total').textContent = 'R$ ' + (total/100).toFixed(2).replace('.', ',');
      } else {
        carr.classList.remove('visivel');
      }
    }

    async function pagar() {
      const btn = document.querySelector('.btn-pagar');
      btn.textContent = 'Gerando link...';
      btn.disabled = true;
      const selecionados = PRODUTOS.filter(p => qtds[p.id] > 0).map(p => ({ id: p.id, qty: qtds[p.id] }));
      try {
        const r = await fetch('/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itens: selecionados })
        });
        const data = await r.json();
        if (data.url) { window.location.href = data.url; }
        else { alert('Erro ao gerar link. Tente novamente.'); btn.textContent = 'Pagar agora →'; btn.disabled = false; }
      } catch(e) { alert('Erro de conexao. Tente novamente.'); btn.textContent = 'Pagar agora →'; btn.disabled = false; }
    }
  </script>
</body>
</html>`);
});

// ── Checkout com multiplos itens ─────────────────────────────
app.post("/checkout", async (req, res) => {
  const { itens } = req.body || {};
  if (!itens || !itens.length) return res.status(400).json({ erro: "nenhum item" });

  const webhookUrl = WEBHOOK_URL || `${req.protocol}://${req.get("host")}/webhook`;
  const lineItems = itens.map(({ id, qty }) => {
    const p = PRODUTOS.find(x => x.id === id);
    if (!p) return null;
    return { quantity: qty, price: p.preco, description: `${p.nome} - AS Fitness` };
  }).filter(Boolean);

  if (!lineItems.length) return res.status(400).json({ erro: "itens invalidos" });

  try {
    const r = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: HANDLE, webhook_url: webhookUrl,
        order_nsu: `cart-${Date.now()}`, items: lineItems }),
    });
    const data = await r.json();
    if (data.url) return res.json({ url: data.url });
    console.error("Erro InfinitePay:", data);
    res.status(500).json({ erro: "erro ao gerar link" });
  } catch (err) {
    console.error("Falha:", err.message);
    res.status(500).json({ erro: "erro de conexao" });
  }
});

// ── Webhook da InfinitePay ───────────────────────────────────
app.post("/webhook", (req, res) => {
  const body = req.body || {};
  console.log("Webhook recebido:", JSON.stringify(body));

  const idTransacao = body.transaction_nsu || body.invoice_slug || body.order_nsu || null;

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
  res.json({ servico: "geladeira-inteligente", status: "online",
    catalogo: "/catalogo", portaAguardandoAbertura: liberarPorta,
    ultimoPagamento, totalEventos: historico.length });
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

app.listen(PORT, () => console.log(`Servidor geladeira rodando na porta ${PORT}`));
