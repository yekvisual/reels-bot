import { BAGSIZ, Bot, HIKAYE, paylasimKurali } from "./bot";
import {
  Env, Hesap, Kural, ayarYaz, ayarlar, bildir, girisBasarili, girisBasarisiz, girisKilitli, hazirSorular, kaydet, linkBul,
  ozet, sahiplen, temizle, tiklamaSay, trGun, uyarilar, VARSAYILAN_AYAR,
} from "./db";
import { IG } from "./ig";
import PANEL from "./panel.html";

const ABONELIK = "messages,messaging_postbacks";
const TOKEN_UYARI = 50 * 864e5; // token 60 günde ölür; 50 günde yenilenmediyse haber ver

// --- Yardımcılar ----------------------------------------------------------------------
const json = (veri: unknown, durum = 200, ek: Record<string, string> = {}) =>
  new Response(JSON.stringify(veri), { status: durum, headers: { "Content-Type": "application/json; charset=utf-8", ...ek } });

async function hmac(anahtar: string, veri: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(anahtar), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(veri));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function esit(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return fark === 0;
}

async function hesaplar(env: Env, hepsi = false): Promise<Hesap[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM hesaplar ${hepsi ? "" : "WHERE aktif = 1"} ORDER BY kullanici`).all<Hesap>();
  return results;
}

// --- Panel oturumu --------------------------------------------------------------------
const OTURUM_SURE = 30 * 864e5;

async function oturumAc(env: Env): Promise<string> {
  const bitis = String(Date.now() + OTURUM_SURE);
  return `${bitis}.${await hmac(env.PANEL_SIFRE, bitis)}`;
}

async function oturumVar(req: Request, env: Env): Promise<boolean> {
  const c = (req.headers.get("Cookie") ?? "").match(/(?:^|;\s*)oturum=([^;]+)/)?.[1];
  if (!c || !env.PANEL_SIFRE) return false;
  const [bitis, imza] = c.split(".");
  return Number(bitis) > Date.now() && esit(imza ?? "", await hmac(env.PANEL_SIFRE, bitis));
}

/** publish.py gibi dış araçlar: Authorization: Bearer <OTOMASYON_ANAHTARI> */
async function disAnahtarVar(req: Request, env: Env): Promise<boolean> {
  const verilen = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!env.OTOMASYON_ANAHTARI || !verilen) return false;
  return esit(await hmac("dis", verilen), await hmac("dis", env.OTOMASYON_ANAHTARI));
}

// --- Webhook --------------------------------------------------------------------------
async function webhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env.VERIFY_TOKEN;
    return new Response(ok ? url.searchParams.get("hub.challenge") : "Doğrulanamadı", { status: ok ? 200 : 403 });
  }
  const govde = await req.text();
  const imza = req.headers.get("X-Hub-Signature-256") ?? "";
  if (!env.APP_SECRET || !esit(imza, `sha256=${await hmac(env.APP_SECRET, govde)}`)) {
    ctx.waitUntil(bildir(env, "imza", "Webhook imzası tutmadı; Meta panelindeki app secret ile APP_SECRET aynı mı?"));
    return new Response("İmza geçersiz", { status: 401 });
  }
  let veri: any;
  try {
    veri = JSON.parse(govde);
  } catch {
    return new Response("Gövde okunamadı", { status: 400 });
  }
  // Meta 200'ü hemen bekliyor; iş arka planda yapılır
  ctx.waitUntil(webhookIsle(veri, env));
  return new Response("ok");
}

async function webhookIsle(veri: any, env: Env) {
  await ayarYaz(env, "son_webhook", String(Date.now()));
  const ayar = await ayarlar(env);
  const liste = await hesaplar(env);
  for (const giris of veri.entry ?? []) {
    const hesap = liste.find((h) => h.id === String(giris.id));
    if (!hesap) continue;
    const bot = new Bot(env, hesap, ayar);
    for (const m of giris.messaging ?? []) {
      try {
        if (m.message && !m.message.is_echo) {
          const msg = m.message;
          const hikaye: string | undefined = msg.reply_to?.story?.id;
          const etiket = (msg.attachments ?? []).some((a: any) => a.type === "story_mention");
          await bot.mesaj(m.sender.id, msg.mid, msg.text ?? null, msg.quick_reply?.payload ?? null, { hikaye, etiket });
        } else if (m.postback) {
          await bot.mesaj(m.sender.id, m.postback.mid ?? `${m.sender.id}:${m.timestamp}`, null, m.postback.payload ?? null);
        }
      } catch (e) {
        await kaydet(env, hesap.id, `webhook işlenemedi: ${(e as Error).message}`);
      }
    }
  }
}

// --- Zamanlanmış işler ----------------------------------------------------------------
async function yokla(env: Env) {
  const ayar = await ayarlar(env);
  const sonWebhook = Number(ayar.son_webhook ?? 0);
  for (const hesap of await hesaplar(env)) {
    const bot = new Bot(env, hesap, ayar);
    for (const [ad, is] of [["yorumlar", () => bot.yorumlar()], ["DM yoklama", () => bot.dmYokla(sonWebhook)]] as const) {
      try {
        await is();
      } catch (e) {
        await kaydet(env, hesap.id, `${ad}: ${(e as Error).message}`);
      }
    }
  }
  await saglik(env);
  if (new Date().getUTCMinutes() === 0) {
    await temizle(env);
    for (const h of await hesaplar(env)) {
      if (Date.now() - h.token_yenilendi > TOKEN_UYARI) {
        await bildir(env, "token", `@${h.kullanici} anahtarı ${Math.round((Date.now() - h.token_yenilendi) / 864e5)} gündür yenilenmedi; 60 günde ölür. Panelden yeni anahtar yapıştırın.`);
      }
    }
  }
  if (env.HEALTHCHECK_URL) await fetch(env.HEALTHCHECK_URL).catch(() => {});
}

/** Son 15 dakikada 5+ gönderim hatası varsa haber verir. */
async function saglik(env: Env) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM kayit WHERE zaman > ? AND metin LIKE '%gönderilemedi%'")
    .bind(Date.now() - 15 * 6e4).first<number>("n");
  if ((n ?? 0) >= 5) await bildir(env, "gonderim", `Son 15 dakikada ${n} mesaj gönderilemedi; olay günlüğüne bakın.`);
}

async function tokenYenile(env: Env) {
  for (const hesap of await hesaplar(env, true)) {
    try {
      const yeni = await new IG(hesap.token).yenile();
      await env.DB.prepare("UPDATE hesaplar SET token = ?, token_yenilendi = ? WHERE id = ?").bind(yeni, Date.now(), hesap.id).run();
      await kaydet(env, hesap.id, "token yenilendi");
    } catch (e) {
      await kaydet(env, hesap.id, `token yenilenemedi: ${(e as Error).message}`);
      await bildir(env, "token", `@${hesap.kullanici} anahtarı yenilenemedi: ${(e as Error).message}`);
    }
  }
}

// --- Link sayacı ------------------------------------------------------------------------
const ONIZLEME_BOT = /facebookexternalhit|meta-external|facebot|whatsapp|twitterbot|telegrambot|bot\b|crawler|spider|preview|curl|wget/i;

async function linkYonlendir(req: Request, env: Env, kod: string, ctx: ExecutionContext): Promise<Response> {
  const kaynak = req.headers.get("Origin") ?? "";
  const cors: Record<string, string> = env.SITE_KOK && kaynak === env.SITE_KOK ? { "Access-Control-Allow-Origin": kaynak, Vary: "Origin" } : {};
  const jsonIstek = new URL(req.url).searchParams.has("json");
  const link = await linkBul(env, kod);
  if (!link) return jsonIstek ? json({ hata: "Link yok" }, 404, cors) : new Response("Link bulunamadı", { status: 404 });
  const ua = req.headers.get("User-Agent") ?? "";
  if (!ONIZLEME_BOT.test(ua)) {
    // Aynı kişi (IP özeti) aynı gün aynı linki bir kez sayılır; IP saklanmaz
    const ip = req.headers.get("CF-Connecting-IP") ?? "-";
    ctx.waitUntil((async () => {
      if (await sahiplen(env, await ozet("t", kod, trGun(Date.now()), ip))) await tiklamaSay(env, kod, link.kural);
    })());
  }
  if (jsonIstek) return json({ url: link.url }, 200, { ...cors, "Cache-Control": "no-store" });
  return new Response(null, { status: 302, headers: { Location: link.url, "Cache-Control": "no-store" } });
}

// --- Dış API (publish.py) -------------------------------------------------------------
/** Paylaşım sonrası kural: aynı medya varsa günceller, açıklama bekleyen kural varsa bağlar, yoksa ekler.
 *  İçerik boşsa kural pasif açılır ve bildirim gider. Tekrar çağrılması ikinci kural açmaz. */
async function disKural(env: Env, k: any): Promise<Response> {
  const medya = String(k.medya ?? "").trim();
  if (!medya) return json({ hata: "medya gerekli" }, 400);
  let hesapId = String(k.hesap ?? "").trim();
  if (!hesapId) {
    const liste = await hesaplar(env);
    if (liste.length !== 1) return json({ hata: "hesap belirtin" }, 400);
    hesapId = liste[0].id;
  }
  const anahtar = String(k.anahtar ?? "").split(",").map((s: string) => s.trim()).filter(Boolean).join(", ");
  const baslik = String(k.baslik ?? "").trim();
  const icerik = String(k.icerik ?? "").trim();
  const aciklama = String(k.aciklama ?? "");
  const takip = k.takip_sart == null ? 1 : k.takip_sart ? 1 : 0;

  const { results: hepsi } = await env.DB.prepare("SELECT * FROM kurallar WHERE hesap = ?").bind(hesapId).all<Kural>();
  let kural = hepsi.find((r) => r.medya === medya);
  let durum = "guncellendi";
  if (!kural) {
    kural = hepsi.find((r) => r.medya.startsWith(BAGSIZ) && aciklama.includes(r.medya.slice(BAGSIZ.length)));
    durum = kural ? "baglandi" : "eklendi";
  }
  if (kural) {
    const yeni = {
      anahtar: anahtar || kural.anahtar, baslik: baslik || kural.baslik, icerik: icerik || kural.icerik,
      aktif: (icerik || kural.icerik) ? kural.aktif : 0,
    };
    await env.DB.prepare("UPDATE kurallar SET medya = ?, anahtar = ?, baslik = ?, icerik = ?, aktif = ? WHERE id = ?")
      .bind(medya, yeni.anahtar, yeni.baslik, yeni.icerik, yeni.aktif, kural.id).run();
    await env.DB.prepare("DELETE FROM medya_sayac WHERE medya = ?").bind(medya).run();
    await kaydet(env, hesapId, `kural ${durum === "baglandi" ? "paylaşıma bağlandı" : "güncellendi"} (publish.py: ${yeni.baslik})`);
    return json({ ok: true, id: kural.id, durum });
  }
  if (!anahtar) return json({ ok: true, durum: "kelime_yok" }); // açıklamada "yorumlara X yaz" yok: kural gerekmez
  const aktif = icerik ? 1 : 0;
  const r = await env.DB.prepare(
    "INSERT INTO kurallar (hesap, medya, anahtar, baslik, icerik, takip_sart, yorum_yaniti, aktif, olusturma) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
  ).bind(hesapId, medya, anahtar, baslik || anahtar, icerik, takip, aktif, Date.now()).run();
  await kaydet(env, hesapId, aktif ? `kural eklendi (publish.py: ${baslik || anahtar})` : `kural pasif eklendi, içerik yok (${baslik || anahtar})`);
  if (!aktif) {
    await bildir(env, "kural_eksik", `"${(baslik || aciklama.split("\n")[0]).slice(0, 60)}" paylaşımında "${anahtar}" kelimesi var ama dm/kurallar.json'da link yok. Panelden içerik girip etkinleştirin.`);
  }
  return json({ ok: true, id: r.meta.last_row_id, durum: aktif ? "eklendi" : "pasif" });
}

// --- Panel API ------------------------------------------------------------------------
async function hesapEkle(env: Env, token: string): Promise<Response> {
  token = token.replace(/\s/g, "");
  const ig = new IG(token);
  let ben: any;
  try {
    ben = await ig.get("me", { fields: "user_id,username" });
  } catch (e) {
    return json({ hata: `Instagram anahtarı kabul etmedi: ${(e as Error).message}` }, 400);
  }
  const id = String(ben.user_id ?? ben.id);
  await env.DB.prepare(
    `INSERT INTO hesaplar (id, kullanici, token, token_yenilendi, aktif) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (id) DO UPDATE SET kullanici = excluded.kullanici, token = excluded.token, token_yenilendi = excluded.token_yenilendi`,
  ).bind(id, ben.username, token, Date.now()).run();
  let abonelik = "webhook aboneliği açıldı";
  if (env.DENEME === "1") abonelik = "deneme modunda webhook aboneliği açılmadı";
  else try {
    await ig.post(`${id}/subscribed_apps?subscribed_fields=${ABONELIK}`, {});
  } catch (e) {
    abonelik = `webhook aboneliği açılamadı (${(e as Error).message}); DM'ler dakikada bir yoklanacak`;
  }
  await kaydet(env, id, `hesap eklendi: @${ben.username}; ${abonelik}`);
  return json({ ok: true, kullanici: ben.username, abonelik });
}

async function paylasimlar(env: Env, hesapId: string): Promise<Response> {
  const hesap = await env.DB.prepare("SELECT * FROM hesaplar WHERE id = ?").bind(hesapId).first<Hesap>();
  if (!hesap) return json({ hata: "Hesap yok" }, 404);
  let medya: any[] = [];
  let hata: string | undefined;
  try {
    medya = (await new IG(hesap.token).get(`${hesap.id}/media`, {
      fields: "id,caption,permalink,timestamp,comments_count,media_type,media_url,thumbnail_url", limit: "30",
    })).data ?? [];
  } catch (e) {
    hata = (e as Error).message;
  }
  const baslangic = trGun(Date.now() - 30 * 864e5);
  const { results: kurallar } = await env.DB.prepare("SELECT * FROM kurallar WHERE hesap = ?").bind(hesapId).all<Kural>();
  const { results: sayilar } = await env.DB.prepare(
    `SELECT kural, tur, SUM(adet) AS adet FROM istatistik
     WHERE kural IN (SELECT id FROM kurallar WHERE hesap = ?) AND gun >= ? GROUP BY kural, tur`,
  ).bind(hesapId, baslangic).all();
  const { results: linkler } = await env.DB.prepare(
    `SELECT l.kod, l.kural, l.url, COALESCE((SELECT SUM(adet) FROM link_tiklama t WHERE t.kod = l.kod AND t.gun >= ?), 0) AS adet
     FROM linkler l WHERE l.kural IN (SELECT id FROM kurallar WHERE hesap = ?)`,
  ).bind(baslangic, hesapId).all();
  return json({ medya, kurallar, sayilar, linkler, hata });
}

async function kisiler(env: Env, hesapId: string, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim().replace(/^@/, "");
  const kural = Number(url.searchParams.get("kural") ?? 0);
  const { results } = await env.DB.prepare(
    `SELECT k.igsid, k.kullanici, k.ad, k.ilk, k.son, k.takipci, k.kaynak,
            (SELECT COUNT(*) FROM teslimler t WHERE t.hesap = k.hesap AND t.igsid = k.igsid) AS teslim,
            (SELECT GROUP_CONCAT(DISTINCT r.baslik) FROM teslimler t JOIN kurallar r ON r.id = t.kural
              WHERE t.hesap = k.hesap AND t.igsid = k.igsid) AS basliklar
     FROM kisiler k
     WHERE k.hesap = ?
       AND (? = '' OR k.kullanici LIKE ? OR k.ad LIKE ?)
       AND (? = 0 OR EXISTS (SELECT 1 FROM teslimler t WHERE t.hesap = k.hesap AND t.igsid = k.igsid AND t.kural = ?))
     ORDER BY k.son DESC LIMIT 500`,
  ).bind(hesapId, q, `%${q}%`, `%${q}%`, kural, kural).all();
  const toplam = await env.DB.prepare("SELECT COUNT(*) AS n FROM kisiler WHERE hesap = ?").bind(hesapId).first<number>("n");
  return json({ kisiler: results, toplam: toplam ?? 0 });
}

async function kuralKaydet(env: Env, k: any): Promise<Response> {
  const anahtar = String(k.anahtar ?? "").split(",").map((s: string) => s.trim()).filter(Boolean).join(", ");
  const medya = String(k.medya ?? "");
  const hikaye = medya.startsWith(HIKAYE);
  const icerik = String(k.icerik ?? "").trim();
  // Hikâye kuralında kelime boş olabilir (her yanıt); pasif kuralda içerik boş olabilir (publish.py açmış, link bekliyor)
  if (!k.hesap || !medya || (!anahtar && !hikaye) || !k.baslik?.trim() || (!icerik && k.aktif)) {
    return json({ hata: hikaye ? "Başlık ve içerik dolu olmalı." : "Anahtar kelime, başlık ve içerik dolu olmalı." }, 400);
  }
  if (medya === BAGSIZ) return json({ hata: "Açıklamada geçen metni yazın." }, 400);
  if (hikaye && !/^hikaye:(\*|\d+)$/.test(medya)) return json({ hata: "Hikâye kimliği sayı olmalı ya da * (tümü)." }, 400);
  const deger = [medya, anahtar, k.baslik.trim(), icerik, k.takip_sart ? 1 : 0, k.yorum_yaniti ? 1 : 0, k.aktif ? 1 : 0];
  if (k.id) {
    await env.DB.prepare("UPDATE kurallar SET medya = ?, anahtar = ?, baslik = ?, icerik = ?, takip_sart = ?, yorum_yaniti = ?, aktif = ? WHERE id = ?")
      .bind(...deger, k.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO kurallar (medya, anahtar, baslik, icerik, takip_sart, yorum_yaniti, aktif, hesap, olusturma) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(...deger, k.hesap, Date.now()).run();
  }
  // Yeni/değişen kuralda paylaşımın yorumları baştan taranır
  await env.DB.prepare("DELETE FROM medya_sayac WHERE medya = ?").bind(medya).run();
  return json({ ok: true });
}

async function hazirSorulariKaydet(env: Env, liste: any): Promise<Response> {
  const temiz = (Array.isArray(liste) ? liste : []).slice(0, 4)
    .map((s: any) => ({ soru: String(s.soru ?? "").trim().slice(0, 80), tur: s.tur === "son" ? "son" : "metin", cevap: String(s.cevap ?? "").trim() }))
    .filter((s: any) => s.soru && (s.tur === "son" || s.cevap));
  await ayarYaz(env, "hazir_sorular", JSON.stringify(temiz));
  const ayar = await ayarlar(env);
  const sonuc: string[] = [];
  for (const h of await hesaplar(env)) {
    try {
      await new Bot(env, h, ayar).hazirSorulariYaz(temiz);
      sonuc.push(`@${h.kullanici}: ${temiz.length ? temiz.length + " soru yazıldı" : "sorular kaldırıldı"}`);
    } catch (e) {
      sonuc.push(`@${h.kullanici}: yazılamadı (${(e as Error).message})`);
    }
  }
  await kaydet(env, null, `hazır sorular: ${sonuc.join("; ")}`);
  return json({ ok: true, sonuc });
}

async function hikayeler(env: Env, hesapId: string): Promise<Response> {
  const hesap = await env.DB.prepare("SELECT * FROM hesaplar WHERE id = ?").bind(hesapId).first<Hesap>();
  if (!hesap) return json({ hata: "Hesap yok" }, 404);
  try {
    const r = await new IG(hesap.token).get(`${hesap.id}/stories`, { fields: "id,media_type,media_url,thumbnail_url,timestamp,permalink" });
    return json({ hikayeler: r.data ?? [] });
  } catch (e) {
    return json({ hikayeler: [], hata: (e as Error).message });
  }
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const yol = url.pathname;
  const govde = req.method === "POST" ? await req.json<any>().catch(() => ({})) : {};
  if (yol === "/api/durum") {
    const ayar = await ayarlar(env);
    const liste = (await hesaplar(env, true)).map(({ token, ...h }) => h);
    const { results: kayit } = await env.DB.prepare("SELECT zaman, hesap, metin FROM kayit ORDER BY id DESC LIMIT 60").all();
    const sablonlar = Object.fromEntries(Object.keys(VARSAYILAN_AYAR).map((k) => [k, ayar[k]]));
    return json({
      hesaplar: liste, sablonlar, hazir_sorular: hazirSorular(ayar), son_webhook: Number(ayar.son_webhook ?? 0),
      deneme: env.DENEME === "1", kayit, uyarilar: uyarilar(ayar),
      bildirim: !!(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT), link_kok: env.LINK_KOK ?? null, otomasyon: !!env.OTOMASYON_ANAHTARI,
    });
  }
  if (yol === "/api/hesap" && req.method === "POST") return hesapEkle(env, String(govde.token ?? ""));
  let m = yol.match(/^\/api\/hesap\/(\d+)$/);
  if (m && req.method === "POST") {
    await env.DB.prepare("UPDATE hesaplar SET aktif = ? WHERE id = ?").bind(govde.aktif ? 1 : 0, m[1]).run();
    return json({ ok: true });
  }
  m = yol.match(/^\/api\/hesap\/(\d+)\/paylasimlar$/);
  if (m) return paylasimlar(env, m[1]);
  m = yol.match(/^\/api\/hesap\/(\d+)\/hikayeler$/);
  if (m) return hikayeler(env, m[1]);
  m = yol.match(/^\/api\/hesap\/(\d+)\/kisiler$/);
  if (m) return kisiler(env, m[1], url);
  m = yol.match(/^\/api\/hesap\/(\d+)\/ozet$/);
  if (m) {
    // Genel bakış için hesabın son 30 günü, gün ve türe göre (Instagram'a gitmez, hızlı)
    const { results } = await env.DB.prepare(
      `SELECT gun, tur, SUM(adet) AS adet FROM istatistik
       WHERE kural IN (SELECT id FROM kurallar WHERE hesap = ?) AND gun >= ? GROUP BY gun, tur`,
    ).bind(m[1], trGun(Date.now() - 30 * 864e5)).all();
    return json({ bugun: trGun(Date.now()), gunler: results });
  }
  if (yol === "/api/kural" && req.method === "POST") return kuralKaydet(env, govde);
  m = yol.match(/^\/api\/kural\/(\d+)$/);
  if (m && req.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM kurallar WHERE id = ?").bind(m[1]),
      env.DB.prepare("DELETE FROM istatistik WHERE kural = ?").bind(m[1]),
      env.DB.prepare("DELETE FROM bekleyen WHERE kural = ?").bind(m[1]),
    ]);
    return json({ ok: true });
  }
  if (yol === "/api/sablonlar" && req.method === "POST") {
    for (const ad of Object.keys(VARSAYILAN_AYAR)) if (ad !== "hazir_sorular" && typeof govde[ad] === "string") await ayarYaz(env, ad, govde[ad]);
    return json({ ok: true });
  }
  if (yol === "/api/hazir-sorular" && req.method === "POST") return hazirSorulariKaydet(env, govde.liste);
  if (yol === "/api/bildirim-dene" && req.method === "POST") {
    await ayarYaz(env, "bildirim_son:deneme", "0");
    await bildir(env, "deneme", "Deneme bildirimi: Telegram bağlantısı çalışıyor.");
    await ayarYaz(env, `uyari:deneme`, JSON.stringify({ zaman: 0, metin: "" }));
    return json({ ok: true, bildirim: !!(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT) });
  }
  if (yol === "/api/simdi" && req.method === "POST") {
    await yokla(env);
    return json({ ok: true });
  }
  return json({ hata: "Bulunamadı" }, 404);
}

// --- Giriş noktaları ------------------------------------------------------------------
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/webhook") return webhook(req, env, ctx);
    const l = url.pathname.match(/^\/l\/([a-z0-9]{4,16})\/?$/);
    if (l) return linkYonlendir(req, env, l[1], ctx);
    if (url.pathname === "/giris" && req.method === "POST") {
      const ip = await ozet("g", req.headers.get("CF-Connecting-IP") ?? "-");
      if (await girisKilitli(env, ip)) return Response.redirect(new URL("/?hata=2", url).toString(), 303);
      const sifre = String((await req.formData()).get("sifre") ?? "");
      if (!env.PANEL_SIFRE || !esit(await hmac("giris", sifre), await hmac("giris", env.PANEL_SIFRE))) {
        await girisBasarisiz(env, ip);
        return Response.redirect(new URL("/?hata=1", url).toString(), 303);
      }
      await girisBasarili(env, ip);
      const guvenli = url.protocol === "https:" ? "; Secure" : ""; // yerel denemede http
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/",
          "Set-Cookie": `oturum=${await oturumAc(env)}; Path=/; HttpOnly${guvenli}; SameSite=Strict; Max-Age=${OTURUM_SURE / 1000}`,
        },
      });
    }
    // Meta uygulamasının Live moda geçmesi için istenen sayfalar
    if (url.pathname === "/gizlilik") return new Response(GIZLILIK, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname === "/api/disari/kural" && req.method === "POST") {
      if (!(await disAnahtarVar(req, env))) return json({ hata: "Anahtar geçersiz" }, 401);
      return disKural(env, await req.json<any>().catch(() => ({})));
    }
    if (url.pathname.startsWith("/api/")) {
      return (await oturumVar(req, env)) ? api(req, env, url) : json({ hata: "Giriş gerekli" }, 401);
    }
    if (url.pathname === "/") {
      return new Response(PANEL, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return new Response("Bulunamadı", { status: 404 });
  },

  async scheduled(olay: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(olay.cron === "0 4 * * 1" ? tokenYenile(env) : yokla(env));
  },
} satisfies ExportedHandler<Env>;

const GIZLILIK = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gizlilik · YEK Lab DM</title>
<body style="font:16px/1.6 system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#1b1a18;background:#fbfaf8">
<h1>Gizlilik</h1>
<p>Bu uygulama yalnızca YEK Lab'ın kendi Instagram hesaplarında, paylaşımlara anahtar kelimeyle yorum yapan, hikâyeye yanıt veren ya da hesaba mesaj yazan kişilere istedikleri linkleri göndermek için çalışır.</p>
<h2>Tutulan veriler</h2>
<ul>
<li>Linki isteyen ya da mesaj yazan kişinin Instagram kullanıcı adı, görünen adı, uygulamaya özel kimliği, ilk ve son etkileşim zamanı, takip durumu ve hangi linklerin ne zaman gönderildiği. Bu kayıtlar 12 ay sonra kendiliğinden silinir.</li>
<li>Yorum ve mesaj içeriği saklanmaz. Aynı yoruma iki kez yanıt gitmemesi için yalnızca geri çevrilemeyen özetler (hash) tutulur ve 30 gün içinde silinir.</li>
<li>Gönderilen linklere tıklama sayılır; IP adresi saklanmaz, yalnızca aynı gün tekrarları ayırt etmek için özeti tutulur.</li>
</ul>
<p>Veriler yalnızca hangi içeriklerin ilgi gördüğünü anlamak için kullanılır; reklam amacıyla kullanılmaz, üçüncü kişilerle paylaşılmaz, Cloudflare altyapısında saklanır.</p>
<h2>Verilerin silinmesi</h2>
<p>Instagram'da ilgili hesaba (ör. @yekvisual) DM'den "verilerimi sil" yazmanız yeterli; kaydınız hemen silinir ve size bilgi verilir. Sorularınız için: iletisim@yeklab.com.tr</p>
</body>`;
