import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

const app = express();

const FRONT_ORIGIN = "https://tierradecalma.com";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

const MAIL_USER = process.env.MAIL_USER;
const MAIL_PASS = process.env.MAIL_PASS;
const OWNER_MAIL = process.env.OWNER_MAIL;
const PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL;

// --- Mailer ---
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: MAIL_USER, pass: MAIL_PASS }
});

async function sendMail({ to, subject, html }) {
  if (!MAIL_USER || !MAIL_PASS) throw new Error("Faltan MAIL_USER/MAIL_PASS");
  return mailer.sendMail({
    from: `"Tierra de Calma" <${MAIL_USER}>`,
    to,
    subject,
    html
  });
}

// --- CORS ---
app.use(express.json());

const ALLOWED_ORIGINS = [
  "https://tierradecalma.com",
  "https://www.tierradecalma.com"
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked: " + origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());

app.get("/", (_, res) => res.send("Backend Tierra de Calma OK"));

// --- Simple dedupe para webhooks (evita mails repetidos) ---
const processedPayments = new Set();

// Crear preferencia (Checkout Pro)
app.post("/create_preference", async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items vacíos" });
    }

    // Order id para mails / tracking
    const orderId = `TDC-${Date.now()}`;

    const preference = {
      external_reference: orderId,
      items: items.map(i => ({
        title: String(i.title || "Producto"),
        quantity: Number(i.quantity || 1),
        unit_price: Number(i.unit_price || 0),
        currency_id: "ARS"
      })),
      back_urls: {
        success: `${FRONT_ORIGIN}/pago-exitoso.html`,
        pending: `${FRONT_ORIGIN}/volver.html`,
        failure: `${FRONT_ORIGIN}/volver.html`
      },
      auto_return: "approved",
      ...(PUBLIC_BACKEND_URL
        ? { notification_url: `${PUBLIC_BACKEND_URL}/webhook` }
        : {})
    };

    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference)
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("MP preference error:", data);
      return res.status(500).json({ error: "MP error", details: data });
    }

    res.json({ init_point: data.init_point, orderId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando preferencia" });
  }
});

// Webhook MP: confirma pago y envía mails
app.post("/webhook", async (req, res) => {
  try {
    const paymentId =
      req.query?.id ||
      req.body?.data?.id ||
      req.body?.id;

    if (!paymentId) return res.sendStatus(200);

    // dedupe
    if (processedPayments.has(String(paymentId))) return res.sendStatus(200);
    processedPayments.add(String(paymentId));

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });

    const payment = await r.json();

    if (!r.ok) {
      console.error("MP payment fetch error:", payment);
      return res.sendStatus(200);
    }

    if (payment.status !== "approved") return res.sendStatus(200);

    const buyerEmail = payment.payer?.email || "";
    const amount = payment.transaction_amount || 0;
    const orderId = payment.external_reference || `TDC-${paymentId}`;

    // Mail a la dueña
    if (OWNER_MAIL) {
      await sendMail({
        to: OWNER_MAIL,
        subject: `🧾 Venta aprobada — ${orderId}`,
        html: `
          <h2>Nueva venta aprobada ✅</h2>
          <p><b>Pedido:</b> ${orderId}</p>
          <p><b>Cliente:</b> ${buyerEmail || "Sin email"}</p>
          <p><b>Total:</b> $${amount}</p>
          <p><b>Payment ID:</b> ${paymentId}</p>
        `
      });
    }

    // Mail al cliente
    if (buyerEmail) {
      await sendMail({
        to: buyerEmail,
        subject: `✨ Gracias por tu compra — ${orderId}`,
        html: `
          <h2>¡Gracias por tu compra! 💚</h2>
          <p>Tu pago fue aprobado correctamente.</p>
          <p><b>Pedido:</b> ${orderId}</p>
          <p><b>Total:</b> $${amount}</p>
          <p>En breve nos pondremos en contacto para coordinar la entrega.</p>
          <p><b>Tierra de Calma</b></p>
        `
      });
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Backend corriendo"));
