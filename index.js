import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

// === ST PIERRE PDD BUCKY DROP CONFIG ===
const WC_URL = process.env.WC_URL; // e.g. https://stpierremarket.co.za
const WC_KEY = process.env.WC_KEY;
const WC_SECRET = process.env.WC_SECRET;

const META_TOKEN = process.env.META_TOKEN; // your Facebook long token
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "buckydrop123";

// Cache
let productsCache = [];
let lastFetch = 0;

async function fetchWooProducts() {
  if (Date.now() - lastFetch < 1000 * 60 * 5 && productsCache.length) return productsCache;
  try {
    const url = `${WC_URL}/wp-json/wc/v3/products?per_page=100&status=publish&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`;
    const res = await axios.get(url);
    productsCache = res.data.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      link: p.permalink,
      image: p.images?.[0]?.src || "",
      stock: p.stock_status
    }));
    lastFetch = Date.now();
    console.log(`Loaded ${productsCache.length} products`);
    return productsCache;
  } catch (e) {
    console.error("Woo fetch error", e.message);
    return productsCache;
  }
}

function findProduct(text) {
  text = text.toLowerCase();
  return productsCache.filter(p => 
    text.split(" ").some(w => w.length>2 && p.name.toLowerCase().includes(w))
  ).slice(0,5);
}

// Health check for Render
app.get("/", (req,res) => {
  res.send("St Pierre PDD BuckyDrop Bot is LIVE 🔥 - /webhook for Facebook/WhatsApp");
});

// Facebook / WhatsApp verification (GET)
app.get("/webhook", (req,res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Facebook / WhatsApp messages (POST)
app.post("/webhook", async (req,res) => {
  res.sendStatus(200); // reply fast
  try {
    await fetchWooProducts();
    const body = req.body;

    // --- WHATSAPP ---
    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const msg = change.value?.messages?.[0];
          const from = msg?.from;
          const text = msg?.text?.body || "";
          if (!from || !text) continue;
          console.log(`WA from ${from}: ${text}`);

          let reply = "";
          const found = findProduct(text);
          if (found.length) {
            reply = `🔥 St Pierre PDD - I found:\n\n` + found.map(p => `• ${p.name} - R${p.price}\n${p.link}`).join("\n\n") + `\n\nReply with number to order, or send delivery address?`;
          } else if (text.toLowerCase().includes("order") || text.toLowerCase().includes("delivery")) {
            reply = `Got it! 🛒 Send me:\n1. What you want (e.g. "1x Chicken, 2x Bread")\n2. Your delivery address\n3. EFT / Cash on delivery?\nWe deliver St Pierre area fast!`;
          } else {
            reply = `Hi! 👋 Welcome to St Pierre PDD Market\n\nWe have ${productsCache.length} products ready.\n\nTry: "What chicken do you have?" or "bread price" or "specials today"\n\nSend your shopping list and I will make order for you.`;
          }
          // send reply via WhatsApp API
          if (WA_PHONE_ID && META_TOKEN) {
            await axios.post(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
              messaging_product: "whatsapp",
              to: from,
              text: { body: reply }
            }, { headers: { Authorization: `Bearer ${META_TOKEN}` }});
          }
        }
      }
    }

    // --- FACEBOOK MESSENGER ---
    if (body.object === "page") {
      for (const entry of body.entry || []) {
        for (const ev of entry.messaging || []) {
          const sender = ev.sender?.id;
          const text = ev.message?.text || "";
          if (!sender || !text) continue;
          console.log(`FB from ${sender}: ${text}`);
          let reply = "";
          const found = findProduct(text);
          if (found.length) {
            reply = `🔥 Found for you:\n\n` + found.map(p => `${p.name} - R${p.price} - ${p.link}`).join("\n") + `\n\nWant me to create checkout link?`;
          } else {
            reply = `Hi! St Pierre PDD here 👋 We have ${productsCache.length} products.\nTell me what you need: e.g. "chicken", "cooldrinks", "specials"\nI can check price and stock instantly.`;
          }
          if (META_TOKEN) {
            await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${META_TOKEN}`, {
              recipient: { id: sender },
              message: { text: reply }
            });
          }
        }
      }
    }

  } catch (e) {
    console.error("webhook error", e.message);
  }
});

// WooCommerce direct search API for your site
app.get("/search", async (req,res) => {
  const q = req.query.q || "";
  await fetchWooProducts();
  const found = findProduct(q);
  res.json(found);
});

app.listen(PORT, () => console.log(`BuckyDrop LIVE on ${PORT}`));