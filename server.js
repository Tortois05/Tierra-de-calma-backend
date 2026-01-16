import express from "express";
import cors from "cors";

const app = express();

const FRONT_ORIGIN = "https://tierradecalma.com";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

app.use(express.json());
const ALLOWED_ORIGINS = [
  "https://tierradecalma.com",
  "https://www.tierradecalma.com"
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/postman
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked: " + origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());


app.get("/", (_, res) => res.send("Backend Tierra de Calma OK"));

app.post("/create_preference", async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: "Items vacíos" });
    }

    const preference = {
  items: items.map(i => ({
    title: i.title,
    quantity: i.quantity,
    unit_price: i.unit_price,
    currency_id: "ARS"
  })),
  back_urls: {
  success: `${FRONT_ORIGIN}/pago-exitoso.html`,
  pending: `${FRONT_ORIGIN}/pago-pendiente.html`,
  failure: `${FRONT_ORIGIN}/pago-fallido.html`
},
  auto_return: "approved",
  ...(process.env.PUBLIC_BACKEND_URL
    ? { notification_url: `${process.env.PUBLIC_BACKEND_URL}/webhook` }
    : {})
};


    const r = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(preference)
      }
    );

    const data = await r.json();
    res.json({ init_point: data.init_point });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando preferencia" });
  }
});

app.post("/webhook", (req, res) => {
  console.log("Webhook MP:", req.body);
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Backend corriendo")
);
