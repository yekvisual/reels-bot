// Giriş noktası: webhook, cron, kısa link, video sunumu, OAuth, Meta geri çağrıları, panel API'si, MCP.

import { BAGSIZ, Bot, HIKAYE } from "./bot";
import {
  Atolye, Env, Hesap, Kural, Gonderi, SISTEM, anahtarlaAtolye, atolyeAc, atolyeBul, ayarYaz, ayarlar, bildir, esitOzet,
  girisBasarili, girisBasarisiz, girisKilitli, hazirSorular, hesapBul, hesapSil, hesaplar, kaydet, linkBul, ozet, sahiplen,
  temizle, tiklamaSay, trGun, urunAdi, uyariKapat, uyarilar, yeniAnahtar, VARSAYILAN_AYAR,
} from "./db";
import { IG } from "./ig";
import { GIZLILIK, KOSULLAR, VERI_SILME } from "./hukuk";
import { mcp } from "./mcp";
import { EN_BUYUK_VIDEO, EN_UZUN_ACIKLAMA, PAYLASIM_IZNI, gonderileriIsle, videolariTemizle } from "./yayin";
import PANEL from "./panel.html";
import SITE from "./site.html";

const ABONELIK = "messages,messaging_postbacks";
const TOKEN_UYARI = 50 * 864e5; // token 60 günde ölür; 50 günde yenilenmediyse haber ver
const TARAMA_SEFERDE = 12;      // bir dakikada yorumları taranacak hesap sayısı (alt-istek sınırı için sırayla)
const OTURUM_SURE = 30 * 864e5;
const OAUTH_IZINLER = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments", PAYLASIM_IZNI].join(",");

// --- Yardımcılar ----------------------------------------------------------------------
const json = (veri: unknown, durum = 200, ek: Record<string, string> = {}) =>
  new Response(JSON.stringify(veri), { status: durum, headers: { "Content-Type": "application/json; charset=utf-8", ...ek } });
const html = (metin: string, ek: Record<string, string> = {}) =>
  new Response(metin, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...ek } });

class HttpHata extends Error {
  constructor(public durum: number, mesaj: string) { super(mesaj); }
}

async function hmac(anahtar: string, veri: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(anahtar), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(veri)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function esit(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return fark === 0;
}

const gizli = (env: Env) => env.OTURUM_GIZLI || env.PANEL_SIFRE;
const yerelMi = (url: URL) => url.protocol !== "https:";
const cerez = (ad: string, deger: string, sure: number, url: URL, yol = "/") =>
  `${ad}=${deger}; Path=${yol}; HttpOnly${yerelMi(url) ? "" : "; Secure"}; SameSite=Lax; Max-Age=${sure}`;
const cerezOku = (req: Request, ad: string) => (req.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${ad}=([^;]+)`))?.[1] ?? "";
const yonlendir = (url: string, ek: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: url, ...ek } });

// --- Oturum ------------------------------------------------------------------------------
interface Oturum { atolye: number; yonetici: boolean }

async function oturumYaz(env: Env, ot: Oturum): Promise<string> {
  const bitis = String(Date.now() + OTURUM_SURE);
  const govde = `${ot.atolye}.${ot.yonetici ? 1 : 0}.${bitis}`;
  return `${govde}.${await hmac(gizli(env), "oturum:" + govde)}`;
}

async function oturumOku(req: Request, env: Env): Promise<Oturum | null> {
  const c = cerezOku(req, "oturum");
  if (!c || !gizli(env)) return null;
  const [atolye, yonetici, bitis, imza] = c.split(".");
  if (!imza || Number(bitis) < Date.now()) return null;
  if (!esit(imza, await hmac(gizli(env), `oturum:${atolye}.${yonetici}.${bitis}`))) return null;
  const ot = { atolye: Number(atolye), yonetici: yonetici === "1" };
  if (!ot.yonetici && ot.atolye > 0) {
    const a = await atolyeBul(env, ot.atolye);
    if (!a) return null;
  }
  return ot;
}

async function oturumCerezi(env: Env, ot: Oturum, url: URL) {
  return cerez("oturum", await oturumYaz(env, ot), OTURUM_SURE / 1000, url);
}

/** İstekteki hesabın oturumdaki atölyeye ait olduğunu doğrular (yönetici her atölyeye girebilir). */
async function yetkiliHesap(env: Env, ot: Oturum, id: string): Promise<Hesap> {
  const h = await hesapBul(env, id);
  if (!h || (!ot.yonetici && h.atolye !== ot.atolye)) throw new HttpHata(404, "Hesap yok");
  return h;
}

async function yetkiliKural(env: Env, ot: Oturum, id: number): Promise<Kural> {
  const k = await env.DB.prepare("SELECT * FROM kurallar WHERE id = ?").bind(id).first<Kural>();
  if (!k) throw new HttpHata(404, "Kural yok");
  await yetkiliHesap(env, ot, k.hesap);
  return k;
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
  ctx.waitUntil(webhookIsle(veri, env)); // Meta 200'ü hemen bekliyor; iş arka planda
  return new Response("ok");
}

async function webhookIsle(veri: any, env: Env) {
  await ayarYaz(env, SISTEM, "son_webhook", String(Date.now()));
  const liste = await hesaplar(env);
  const ayarOnbellek = new Map<number, Record<string, string>>();
  for (const giris of veri.entry ?? []) {
    const hesap = liste.find((h) => h.id === String(giris.id));
    if (!hesap) continue;
    if (!ayarOnbellek.has(hesap.atolye)) ayarOnbellek.set(hesap.atolye, await ayarlar(env, hesap.atolye));
    const bot = new Bot(env, hesap, ayarOnbellek.get(hesap.atolye)!);
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
        await kaydet(env, hesap.atolye, hesap.id, `webhook işlenemedi: ${(e as Error).message}`);
      }
    }
  }
}

// --- Zamanlanmış işler ----------------------------------------------------------------
/** Hesapların yorumlarını tarar: en uzun süredir taranmayan hesaplardan başlayarak seferde TARAMA_SEFERDE hesap. */
async function tara(env: Env, hesapListesi: Hesap[]) {
  const sonWebhook = Number((await ayarlar(env, SISTEM)).son_webhook ?? 0);
  const ayarOnbellek = new Map<number, Record<string, string>>();
  for (const hesap of hesapListesi) {
    if (!ayarOnbellek.has(hesap.atolye)) ayarOnbellek.set(hesap.atolye, await ayarlar(env, hesap.atolye));
    const bot = new Bot(env, hesap, ayarOnbellek.get(hesap.atolye)!);
    for (const [ad, is] of [["yorumlar", () => bot.yorumlar()], ["DM yoklama", () => bot.dmYokla(sonWebhook)]] as const) {
      try {
        await is();
      } catch (e) {
        await kaydet(env, hesap.atolye, hesap.id, `${ad}: ${(e as Error).message}`);
      }
    }
    await env.DB.prepare("UPDATE hesaplar SET son_tarama = ? WHERE id = ?").bind(Date.now(), hesap.id).run();
  }
}

async function yokla(env: Env) {
  const { results: sira } = await env.DB.prepare(
    "SELECT h.* FROM hesaplar h JOIN atolyeler a ON a.id = h.atolye WHERE h.aktif = 1 AND a.aktif = 1 ORDER BY h.son_tarama LIMIT ?",
  ).bind(TARAMA_SEFERDE).all<Hesap>();
  await tara(env, sira);
  try {
    await gonderileriIsle(env);
  } catch (e) {
    await kaydet(env, SISTEM, null, `gönderiler işlenemedi: ${(e as Error).message}`);
  }
  await saglik(env);
  if (new Date().getUTCMinutes() === 0) {
    await temizle(env);
    await videolariTemizle(env).catch(async (e) => kaydet(env, SISTEM, null, `video temizliği: ${(e as Error).message}`));
    for (const h of await hesaplar(env)) {
      if (Date.now() - h.token_yenilendi > TOKEN_UYARI) {
        const gun = Math.round((Date.now() - h.token_yenilendi) / 864e5);
        await bildir(env, "token", `@${h.kullanici} bağlantısı ${gun} gündür yenilenemiyor; 60 günde kopar. Ayarlar → Hesaplar'dan yeniden bağlayın.`, h.atolye);
      }
    }
  }
  if (env.HEALTHCHECK_URL) await fetch(env.HEALTHCHECK_URL).catch(() => {});
}

/** Son 15 dakikada 5+ gönderim hatası varsa yöneticiye haber verir. */
async function saglik(env: Env) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM kayit WHERE zaman > ? AND metin LIKE '%gönderilemedi%'")
    .bind(Date.now() - 15 * 6e4).first<number>("n");
  if ((n ?? 0) >= 5) await bildir(env, "gonderim", `Son 15 dakikada ${n} mesaj gönderilemedi; olay günlüğüne bakın.`);
}

async function tokenYenile(env: Env) {
  for (const hesap of await hesaplar(env, undefined, true)) {
    try {
      const yeni = await new IG(hesap.token).yenile();
      await env.DB.prepare("UPDATE hesaplar SET token = ?, token_yenilendi = ? WHERE id = ?").bind(yeni, Date.now(), hesap.id).run();
      await kaydet(env, hesap.atolye, hesap.id, "Instagram bağlantısı yenilendi");
    } catch (e) {
      await kaydet(env, hesap.atolye, hesap.id, `bağlantı yenilenemedi: ${(e as Error).message}`);
      await bildir(env, "token", `@${hesap.kullanici} bağlantısı yenilenemedi: ${(e as Error).message}. Ayarlar → Hesaplar'dan yeniden bağlayın.`, hesap.atolye);
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
    const ip = req.headers.get("CF-Connecting-IP") ?? "-";
    ctx.waitUntil((async () => {
      if (await sahiplen(env, await ozet("t", kod, trGun(Date.now()), ip))) await tiklamaSay(env, kod, link.kural);
    })());
  }
  if (jsonIstek) return json({ url: link.url }, 200, { ...cors, "Cache-Control": "no-store" });
  return new Response(null, { status: 302, headers: { Location: link.url, "Cache-Control": "no-store" } });
}

// --- Video sunumu (Instagram videoyu buradan indirir) ---------------------------------
async function videoSun(req: Request, env: Env, dosya: string): Promise<Response> {
  if (!env.VIDEO) return new Response("Depolama kapalı", { status: 404 });
  const basliklar = (o: R2Object) => {
    const h = new Headers();
    o.writeHttpMetadata(h);
    h.set("Content-Type", "video/mp4");
    h.set("Accept-Ranges", "bytes");
    h.set("ETag", o.httpEtag);
    h.set("Cache-Control", "public, max-age=3600");
    return h;
  };
  if (req.method === "HEAD") {
    const o = await env.VIDEO.head(dosya);
    if (!o) return new Response(null, { status: 404 });
    const h = basliklar(o);
    h.set("Content-Length", String(o.size));
    return new Response(null, { headers: h });
  }
  const o = await env.VIDEO.get(dosya, { range: req.headers, onlyIf: req.headers });
  if (!o) return new Response("Video yok", { status: 404 });
  const h = basliklar(o);
  if (!("body" in o)) return new Response(null, { status: 304, headers: h });
  if (req.headers.has("Range") && o.range) {
    const sonek = "suffix" in o.range && typeof o.range.suffix === "number" ? o.range.suffix : null;
    const bas = sonek != null ? Math.max(0, o.size - sonek) : ("offset" in o.range ? o.range.offset ?? 0 : 0);
    const uz = sonek != null ? o.size - bas : ("length" in o.range && typeof o.range.length === "number" ? o.range.length : o.size - bas);
    h.set("Content-Range", `bytes ${bas}-${bas + uz - 1}/${o.size}`);
    h.set("Content-Length", String(uz));
    return new Response(o.body, { status: 206, headers: h });
  }
  h.set("Content-Length", String(o.size));
  return new Response(o.body, { headers: h });
}

/** Panelden ya da MCP'den video yükleme: akış olarak R2'ye yazılır. */
async function videoYukle(req: Request, env: Env, atolye: number, url: URL): Promise<Response> {
  if (!env.VIDEO) return json({ hata: "Video depolama henüz açık değil (R2). Yöneticiye yazın." }, 503);
  const ad = (url.searchParams.get("ad") ?? "video.mp4").replace(/[^\w.\-() ]/g, "_").slice(0, 120);
  if (!/\.(mp4|mov|m4v)$/i.test(ad)) return json({ hata: "Yalnızca MP4 ya da MOV video yüklenebilir." }, 400);
  const boyut = Number(req.headers.get("Content-Length") ?? 0);
  if (!req.body || !boyut) return json({ hata: "Dosya boş ya da boyutu bilinmiyor." }, 400);
  if (boyut > EN_BUYUK_VIDEO) return json({ hata: "Video 100 MB'tan büyük olamaz." }, 413);
  const dosya = `${atolye}/${crypto.randomUUID()}.mp4`;
  await env.VIDEO.put(dosya, req.body, { httpMetadata: { contentType: "video/mp4" }, customMetadata: { ad, atolye: String(atolye) } });
  return json({ ok: true, dosya, ad, boyut });
}

// --- Gönderiler (planlı yayın) -------------------------------------------------------
async function gonderiKaydet(env: Env, ot: Oturum, g: any): Promise<Response> {
  const hesap = await yetkiliHesap(env, ot, String(g.hesap ?? ""));
  const aciklama = String(g.aciklama ?? "").trim();
  const zaman = Number(g.zaman ?? 0);
  if (!zaman || !Number.isFinite(zaman)) return json({ hata: "Yayın zamanı gerekli." }, 400);
  if (aciklama.length > EN_UZUN_ACIKLAMA) return json({ hata: `Açıklama en çok ${EN_UZUN_ACIKLAMA} karakter.` }, 400);
  if (zaman < Date.now() - 6e4 && !g.id) return json({ hata: "Yayın zamanı geçmişte olamaz." }, 400);
  const kuralAnahtar = String(g.kural_anahtar ?? "").split(",").map((s: string) => s.trim()).filter(Boolean).join(", ");
  const alanlar = {
    aciklama, zaman, feed: g.feed === false ? 0 : 1, kural_anahtar: kuralAnahtar, kural_baslik: String(g.kural_baslik ?? "").trim().slice(0, 80),
    kural_icerik: String(g.kural_icerik ?? "").trim().slice(0, 1000), kural_takip: g.kural_takip === false ? 0 : 1,
  };
  if (g.id) {
    const eski = await env.DB.prepare("SELECT * FROM gonderiler WHERE id = ?").bind(Number(g.id)).first<Gonderi>();
    if (!eski || (!ot.yonetici && eski.atolye !== ot.atolye)) return json({ hata: "Gönderi yok" }, 404);
    if (!["bekliyor", "hata"].includes(eski.durum)) return json({ hata: "Yayınlanmış ya da işlenmekte olan gönderi düzenlenemez." }, 400);
    if (env.VIDEO && !(await env.VIDEO.head(eski.dosya))) return json({ hata: "Video artık depoda yok; gönderiyi yeniden oluşturun." }, 400);
    await env.DB.prepare(
      "UPDATE gonderiler SET hesap = ?, atolye = ?, aciklama = ?, zaman = ?, feed = ?, kural_anahtar = ?, kural_baslik = ?, kural_icerik = ?, kural_takip = ?, durum = 'bekliyor', hata = NULL, deneme = 0, konteyner = NULL WHERE id = ?",
    ).bind(hesap.id, hesap.atolye, alanlar.aciklama, alanlar.zaman, alanlar.feed, alanlar.kural_anahtar, alanlar.kural_baslik, alanlar.kural_icerik, alanlar.kural_takip, eski.id).run();
    return json({ ok: true, id: eski.id });
  }
  const dosya = String(g.dosya ?? "");
  if (!dosya.startsWith(`${hesap.atolye}/`)) return json({ hata: "Önce video yükleyin." }, 400);
  if (!env.VIDEO) return json({ hata: "Video depolama kapalı." }, 503);
  const nesne = await env.VIDEO.head(dosya);
  if (!nesne) return json({ hata: "Yüklenen video bulunamadı; yeniden yükleyin." }, 400);
  const r = await env.DB.prepare(
    `INSERT INTO gonderiler (atolye, hesap, dosya, ad, boyut, aciklama, zaman, feed, kural_anahtar, kural_baslik, kural_icerik, kural_takip, olusturma, adim_zamani)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(hesap.atolye, hesap.id, dosya, nesne.customMetadata?.ad ?? "video.mp4", nesne.size, alanlar.aciklama, alanlar.zaman, alanlar.feed,
    alanlar.kural_anahtar, alanlar.kural_baslik, alanlar.kural_icerik, alanlar.kural_takip, Date.now(), Date.now()).run();
  await kaydet(env, hesap.atolye, hesap.id, `gönderi #${r.meta.last_row_id} planlandı: ${new Date(zaman).toISOString()}`);
  return json({ ok: true, id: r.meta.last_row_id });
}

async function gonderiler(env: Env, ot: Oturum): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM gonderiler WHERE atolye = ? ORDER BY CASE durum WHEN 'bekliyor' THEN 0 WHEN 'isleniyor' THEN 0 WHEN 'hata' THEN 1 ELSE 2 END, zaman DESC LIMIT 200",
  ).bind(ot.atolye).all<Gonderi>();
  return json({ gonderiler: results, video: !!env.VIDEO });
}

async function gonderiBul(env: Env, ot: Oturum, id: number): Promise<Gonderi> {
  const g = await env.DB.prepare("SELECT * FROM gonderiler WHERE id = ?").bind(id).first<Gonderi>();
  if (!g || (!ot.yonetici && g.atolye !== ot.atolye)) throw new HttpHata(404, "Gönderi yok");
  return g;
}

// --- Dış API (publish.py, curl) ------------------------------------------------------
/** Paylaşım sonrası kural: aynı medya varsa günceller, açıklama bekleyen kural varsa bağlar, yoksa ekler.
 *  İçerik boşsa kural pasif açılır ve uyarı verilir. Tekrar çağrılması ikinci kural açmaz. */
async function disKural(env: Env, atolye: Atolye, k: any): Promise<Response> {
  const medya = String(k.medya ?? "").trim();
  if (!medya) return json({ hata: "medya gerekli" }, 400);
  let hesapId = String(k.hesap ?? "").trim();
  const liste = await hesaplar(env, atolye.id, true);
  if (!hesapId) {
    if (liste.length !== 1) return json({ hata: "hesap belirtin" }, 400);
    hesapId = liste[0].id;
  }
  if (!liste.some((h) => h.id === hesapId)) return json({ hata: "hesap bu atölyeye bağlı değil" }, 403);
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
    await kaydet(env, atolye.id, hesapId, `kural ${durum === "baglandi" ? "paylaşıma bağlandı" : "güncellendi"} (API: ${yeni.baslik})`);
    return json({ ok: true, id: kural.id, durum });
  }
  if (!anahtar) return json({ ok: true, durum: "kelime_yok" });
  const aktif = icerik ? 1 : 0;
  const r = await env.DB.prepare(
    "INSERT INTO kurallar (hesap, medya, anahtar, baslik, icerik, takip_sart, yorum_yaniti, aktif, olusturma) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
  ).bind(hesapId, medya, anahtar, baslik || anahtar, icerik, takip, aktif, Date.now()).run();
  await kaydet(env, atolye.id, hesapId, aktif ? `kural eklendi (API: ${baslik || anahtar})` : `kural pasif eklendi, içerik yok (${baslik || anahtar})`);
  if (!aktif) {
    await bildir(env, "kural_eksik", `"${(baslik || aciklama.split("\n")[0]).slice(0, 60)}" paylaşımında "${anahtar}" kelimesi var ama gönderilecek içerik yok. Otomasyonlar'dan içerik girip etkinleştirin.`, atolye.id);
  }
  return json({ ok: true, id: r.meta.last_row_id, durum: aktif ? "eklendi" : "pasif" });
}

// --- Hesap kaydı ve Instagram girişi (OAuth) ------------------------------------------
/** Uzun ömürlü anahtarla hesabı kaydeder ve webhook aboneliğini açar. */
async function hesapKaydet(env: Env, atolye: number, token: string, izinler = ""): Promise<{ id: string; kullanici: string; abonelik: string }> {
  token = token.replace(/\s/g, "");
  const ig = new IG(token);
  const ben: any = await ig.get("me", { fields: "user_id,username" });
  const id = String(ben.user_id ?? ben.id);
  await env.DB.prepare(
    `INSERT INTO hesaplar (id, atolye, kullanici, token, token_yenilendi, aktif, izinler, eklenme) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET atolye = excluded.atolye, kullanici = excluded.kullanici, token = excluded.token,
       token_yenilendi = excluded.token_yenilendi, izinler = CASE WHEN excluded.izinler = '' THEN izinler ELSE excluded.izinler END`,
  ).bind(id, atolye, ben.username, token, Date.now(), izinler, Date.now()).run();
  let abonelik = "webhook aboneliği açıldı";
  if (env.DENEME === "1") abonelik = "deneme modunda webhook aboneliği açılmadı";
  else try {
    await ig.post(`${id}/subscribed_apps?subscribed_fields=${ABONELIK}`, {});
  } catch (e) {
    abonelik = `webhook aboneliği açılamadı (${(e as Error).message}); DM'ler dakikada bir yoklanacak`;
  }
  await kaydet(env, atolye, id, `hesap bağlandı: @${ben.username}; ${abonelik}`);
  return { id, kullanici: ben.username, abonelik };
}

const oauthDonus = (url: URL) => `${url.origin}/oauth`;

/** Instagram'a gönderir. amac: "giris" (panele giriş; hesap yoksa atölye açılır) ya da "bagla" (oturumdaki atölyeye ekle). */
async function oauthBaslat(env: Env, url: URL, amac: "giris" | "bagla", atolye: number): Promise<Response> {
  if (!env.INSTAGRAM_APP_ID) return html(`<p style="font:16px system-ui;padding:40px">Instagram girişi henüz ayarlanmadı (INSTAGRAM_APP_ID).</p>`);
  const nonce = crypto.randomUUID();
  const govde = `${amac}.${atolye}.${nonce}`;
  const state = `${govde}.${await hmac(gizli(env), "oauth:" + govde)}`;
  const hedef = new URL("https://www.instagram.com/oauth/authorize");
  for (const [k, v] of Object.entries({
    client_id: env.INSTAGRAM_APP_ID, redirect_uri: oauthDonus(url), response_type: "code", scope: OAUTH_IZINLER, state,
    force_reauth: "true", // hangi hesapla gireceğini her seferinde sorsun
  })) hedef.searchParams.set(k, v);
  return yonlendir(hedef.toString(), { "Set-Cookie": cerez("baglan", state, 600, url, "/oauth") });
}

/** Instagram'dan dönüş: kodu uzun ömürlü anahtara çevirir; girişte atölyeyi bulur ya da açar, bağlamada hesabı ekler. */
async function oauth(req: Request, env: Env, url: URL): Promise<Response> {
  const geri = (mesaj: string, hata = false, yol = "/", ek: Record<string, string> = {}) => {
    const [yolu, parca] = yol.split("#");
    return yonlendir(`${url.origin}${yolu}?${hata ? "hata" : "mesaj"}=${encodeURIComponent(mesaj)}${parca ? "#" + parca : ""}`, ek);
  };
  const state = url.searchParams.get("state") ?? "";
  const [amac, atolyeStr, nonce, imza] = state.split(".");
  const c = cerezOku(req, "baglan");
  if (!state || !imza || !esit(state, c) || !esit(imza, await hmac(gizli(env), `oauth:${amac}.${atolyeStr}.${nonce}`))) {
    return geri("Bağlantı doğrulanamadı; yeniden deneyin.", true);
  }
  const giris = amac === "giris";
  const atolye = Number(atolyeStr);
  const panelYolu = giris ? "/" : "/#ayar";
  if (url.searchParams.get("error")) {
    return geri(`Instagram bağlanmadı: ${url.searchParams.get("error_description") ?? url.searchParams.get("error_reason") ?? "izin verilmedi"}`, true, panelYolu);
  }
  const kod = (url.searchParams.get("code") ?? "").replace(/#_$/, "");
  if (!kod) return geri("Instagram kod göndermedi.", true, panelYolu);
  try {
    const govde = new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID ?? "", client_secret: env.APP_SECRET, grant_type: "authorization_code",
      redirect_uri: oauthDonus(url), code: kod,
    });
    const kisa: any = await (await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: govde })).json();
    if (!kisa.access_token) throw new Error(kisa.error_message ?? kisa.error?.message ?? JSON.stringify(kisa).slice(0, 200));
    const izinler: string = Array.isArray(kisa.permissions) ? kisa.permissions.join(",") : String(kisa.permissions ?? "");
    const uzunUrl = new URL("https://graph.instagram.com/access_token");
    uzunUrl.searchParams.set("grant_type", "ig_exchange_token");
    uzunUrl.searchParams.set("client_secret", env.APP_SECRET);
    uzunUrl.searchParams.set("access_token", kisa.access_token);
    const uzun: any = await (await fetch(uzunUrl)).json();
    if (!uzun.access_token) throw new Error(uzun.error?.message ?? "uzun ömürlü anahtar alınamadı");
    const igId = String(kisa.user_id ?? "");
    const mevcut = igId ? await hesapBul(env, igId) : null;

    if (giris) {
      let hedef = mevcut ? await atolyeBul(env, mevcut.atolye) : null;
      if (!hedef) {
        const ben: any = await new IG(uzun.access_token).get("me", { fields: "username" });
        hedef = await atolyeAc(env, "@" + ben.username);
        await kaydet(env, SISTEM, null, `yeni atölye #${hedef.id}: @${ben.username}`);
        await kaydet(env, hedef.id, null, `Hoş geldiniz! Atölyeniz açıldı.`);
      }
      const sonuc = await hesapKaydet(env, hedef.id, uzun.access_token, izinler);
      await env.DB.prepare("UPDATE atolyeler SET son_giris = ? WHERE id = ?").bind(Date.now(), hedef.id).run();
      return geri(`@${sonuc.kullanici} ile giriş yapıldı`, false, "/", { "Set-Cookie": await oturumCerezi(env, { atolye: hedef.id, yonetici: false }, url) });
    }
    // Bağlama: hesap başka bir atölyedeyse eklenmez
    if (mevcut && mevcut.atolye !== atolye) {
      return geri("Bu Instagram hesabı başka bir atölyeye bağlı. Oradan kaldırıp yeniden deneyin.", true, panelYolu);
    }
    const sonuc = await hesapKaydet(env, atolye, uzun.access_token, izinler);
    return geri(`@${sonuc.kullanici} bağlandı; ${sonuc.abonelik}`, false, panelYolu);
  } catch (e) {
    await kaydet(env, giris ? SISTEM : atolye, null, `Instagram girişi başarısız: ${(e as Error).message}`);
    return geri(`Instagram bağlanamadı: ${(e as Error).message}`, true, panelYolu);
  }
}

// --- Meta geri çağrıları: yetki kaldırma ve veri silme (signed_request) ---------------
async function imzaliIstek(req: Request, env: Env): Promise<{ user_id?: string } | null> {
  const form = await req.formData().catch(() => null);
  const sr = String(form?.get("signed_request") ?? "");
  const [imza, govde] = sr.split(".");
  if (!imza || !govde) return null;
  const b64 = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/");
  const beklenen = await hmac(env.APP_SECRET, govde);
  const verilen = [...Uint8Array.from(atob(b64(imza)), (c) => c.charCodeAt(0))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!esit(beklenen, verilen)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64(govde)), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

async function metaGeriCagri(req: Request, env: Env, url: URL, tur: "deauthorize" | "veri-silme"): Promise<Response> {
  const veri = await imzaliIstek(req, env);
  if (!veri?.user_id) return json({ hata: "signed_request geçersiz" }, 400);
  const h = await hesapBul(env, String(veri.user_id));
  if (h) {
    await hesapSil(env, h.id);
    await kaydet(env, h.atolye, null, tur === "deauthorize" ? `@${h.kullanici} uygulamanın yetkisini kaldırdı; hesap ve verileri silindi` : `@${h.kullanici} için Meta veri silme isteği; hesap ve verileri silindi`);
  }
  const kod = (await ozet("s", String(veri.user_id), String(Date.now()))).slice(0, 10);
  await ayarYaz(env, SISTEM, `silme:${kod}`, JSON.stringify({ zaman: Date.now(), bulundu: !!h }));
  return json({ url: `${url.origin}/veri-silme?kod=${kod}`, confirmation_code: kod });
}

// --- Panel API ------------------------------------------------------------------------
async function paylasimlar(env: Env, hesap: Hesap): Promise<Response> {
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
  const { results: kurallar } = await env.DB.prepare("SELECT * FROM kurallar WHERE hesap = ?").bind(hesap.id).all<Kural>();
  const { results: sayilar } = await env.DB.prepare(
    `SELECT kural, tur, SUM(adet) AS adet FROM istatistik
     WHERE kural IN (SELECT id FROM kurallar WHERE hesap = ?) AND gun >= ? GROUP BY kural, tur`,
  ).bind(hesap.id, baslangic).all();
  const { results: linkler } = await env.DB.prepare(
    `SELECT l.kod, l.kural, l.url, COALESCE((SELECT SUM(adet) FROM link_tiklama t WHERE t.kod = l.kod AND t.gun >= ?), 0) AS adet
     FROM linkler l WHERE l.kural IN (SELECT id FROM kurallar WHERE hesap = ?)`,
  ).bind(baslangic, hesap.id).all();
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

async function kuralKaydet(env: Env, ot: Oturum, k: any): Promise<Response> {
  const anahtar = String(k.anahtar ?? "").split(",").map((s: string) => s.trim()).filter(Boolean).join(", ");
  const medya = String(k.medya ?? "");
  const hikaye = medya.startsWith(HIKAYE);
  const icerik = String(k.icerik ?? "").trim();
  if (!k.hesap || !medya || (!anahtar && !hikaye) || !k.baslik?.trim() || (!icerik && k.aktif)) {
    return json({ hata: hikaye ? "Başlık ve içerik dolu olmalı." : "Anahtar kelime, başlık ve içerik dolu olmalı." }, 400);
  }
  if (medya === BAGSIZ) return json({ hata: "Açıklamada geçen metni yazın." }, 400);
  if (hikaye && !/^hikaye:(\*|\d+)$/.test(medya)) return json({ hata: "Hikâye kimliği sayı olmalı ya da * (tümü)." }, 400);
  const hesap = await yetkiliHesap(env, ot, String(k.hesap));
  const deger = [medya, anahtar, k.baslik.trim(), icerik.slice(0, 1000), k.takip_sart ? 1 : 0, k.yorum_yaniti ? 1 : 0, k.aktif ? 1 : 0];
  if (k.id) {
    const eski = await yetkiliKural(env, ot, Number(k.id));
    await env.DB.prepare("UPDATE kurallar SET medya = ?, anahtar = ?, baslik = ?, icerik = ?, takip_sart = ?, yorum_yaniti = ?, aktif = ?, hesap = ? WHERE id = ?")
      .bind(...deger, hesap.id, eski.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO kurallar (medya, anahtar, baslik, icerik, takip_sart, yorum_yaniti, aktif, hesap, olusturma) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(...deger, hesap.id, Date.now()).run();
  }
  await env.DB.prepare("DELETE FROM medya_sayac WHERE medya = ?").bind(medya).run(); // paylaşımın yorumları baştan taranır
  return json({ ok: true });
}

async function hazirSorulariKaydet(env: Env, ot: Oturum, liste: any): Promise<Response> {
  const temiz = (Array.isArray(liste) ? liste : []).slice(0, 4)
    .map((s: any) => ({ soru: String(s.soru ?? "").trim().slice(0, 80), tur: s.tur === "son" ? "son" : "metin", cevap: String(s.cevap ?? "").trim() }))
    .filter((s: any) => s.soru && (s.tur === "son" || s.cevap));
  await ayarYaz(env, ot.atolye, "hazir_sorular", JSON.stringify(temiz));
  const ayar = await ayarlar(env, ot.atolye);
  const sonuc: string[] = [];
  for (const h of await hesaplar(env, ot.atolye)) {
    try {
      await new Bot(env, h, ayar).hazirSorulariYaz(temiz);
      sonuc.push(`@${h.kullanici}: ${temiz.length ? temiz.length + " soru yazıldı" : "sorular kaldırıldı"}`);
    } catch (e) {
      sonuc.push(`@${h.kullanici}: yazılamadı (${(e as Error).message})`);
    }
  }
  await kaydet(env, ot.atolye, null, `hazır sorular: ${sonuc.join("; ")}`);
  return json({ ok: true, sonuc });
}

async function hikayeler(env: Env, hesap: Hesap): Promise<Response> {
  try {
    const r = await new IG(hesap.token).get(`${hesap.id}/stories`, { fields: "id,media_type,media_url,thumbnail_url,timestamp,permalink" });
    return json({ hikayeler: r.data ?? [] });
  } catch (e) {
    return json({ hikayeler: [], hata: (e as Error).message });
  }
}

async function durum(env: Env, ot: Oturum, url: URL): Promise<Response> {
  const atolye = ot.atolye ? await atolyeBul(env, ot.atolye) : null;
  const ayar = await ayarlar(env, ot.atolye);
  const liste = (await hesaplar(env, ot.atolye, true)).map(({ token, ...h }) => ({
    ...h, paylasim_izni: !h.izinler || h.izinler.split(",").includes(PAYLASIM_IZNI),
  }));
  const { results: kayit } = await env.DB.prepare("SELECT zaman, hesap, metin FROM kayit WHERE atolye = ? ORDER BY id DESC LIMIT 80").bind(ot.atolye).all();
  const sablonlar = Object.fromEntries(Object.keys(VARSAYILAN_AYAR).map((k) => [k, ayar[k]]));
  const sonWebhook = Number((await ayarlar(env, SISTEM)).son_webhook ?? 0);
  const { results: gonderiSayilari } = await env.DB.prepare("SELECT durum, COUNT(*) AS n FROM gonderiler WHERE atolye = ? GROUP BY durum").bind(ot.atolye).all();
  return json({
    atolye: atolye ? { id: atolye.id, ad: atolye.ad, plan: atolye.plan, aktif: atolye.aktif, anahtar: atolye.anahtar, olusturma: atolye.olusturma } : null,
    yonetici: ot.yonetici, urun_adi: urunAdi(env), kok: env.KOK ?? url.origin, iletisim: env.ILETISIM ?? "",
    hesaplar: liste, sablonlar, hazir_sorular: hazirSorular(ayar), son_webhook: sonWebhook,
    deneme: env.DENEME === "1", kayit, uyarilar: uyarilar(ayar),
    bildirim: !!(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT), link_kok: env.LINK_KOK ?? null,
    oauth: !!env.INSTAGRAM_APP_ID, video: !!env.VIDEO, kapali_beta: env.KAPALI_BETA === "1", gonderi: Object.fromEntries(gonderiSayilari.map((g: any) => [g.durum, g.n])),
  });
}

async function yoneticiApi(req: Request, env: Env, url: URL, ot: Oturum, govde: any): Promise<Response> {
  if (!ot.yonetici) return json({ hata: "Yönetici gerekli" }, 403);
  const yol = url.pathname;
  if (yol === "/api/yonetici/atolyeler") {
    const { results } = await env.DB.prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM hesaplar h WHERE h.atolye = a.id) AS hesap,
              (SELECT GROUP_CONCAT(h.kullanici, ', ') FROM hesaplar h WHERE h.atolye = a.id) AS kullanicilar,
              (SELECT COUNT(*) FROM kurallar k JOIN hesaplar h ON h.id = k.hesap WHERE h.atolye = a.id AND k.aktif = 1) AS kural,
              (SELECT COUNT(*) FROM gonderiler g WHERE g.atolye = a.id AND g.durum IN ('bekliyor','isleniyor')) AS bekleyen_gonderi,
              (SELECT COALESCE(SUM(i.adet), 0) FROM istatistik i JOIN kurallar k ON k.id = i.kural JOIN hesaplar h ON h.id = k.hesap
                 WHERE h.atolye = a.id AND i.tur = 'teslim' AND i.gun >= ?) AS teslim30,
              (SELECT MAX(zaman) FROM kayit WHERE kayit.atolye = a.id) AS son_olay
       FROM atolyeler a ORDER BY a.son_giris DESC`,
    ).bind(trGun(Date.now() - 30 * 864e5)).all();
    const sistemAyar = await ayarlar(env, SISTEM);
    const { results: kayit } = await env.DB.prepare("SELECT zaman, atolye, hesap, metin FROM kayit WHERE atolye = 0 ORDER BY id DESC LIMIT 60").all();
    const toplam = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM hesaplar) AS hesap, (SELECT COUNT(*) FROM kurallar WHERE aktif = 1) AS kural, (SELECT COUNT(*) FROM kisiler) AS kisi").first();
    return json({ atolyeler: results.map(({ anahtar, ...a }: any) => a), uyarilar: uyarilar(sistemAyar), kayit, toplam, bildirim: !!(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT), video: !!env.VIDEO });
  }
  let m = yol.match(/^\/api\/yonetici\/atolye\/(\d+)$/);
  if (m && req.method === "POST") {
    const a = await atolyeBul(env, Number(m[1]));
    if (!a) return json({ hata: "Atölye yok" }, 404);
    await env.DB.prepare("UPDATE atolyeler SET aktif = ?, plan = ?, notlar = ?, ad = ? WHERE id = ?").bind(
      govde.aktif == null ? a.aktif : govde.aktif ? 1 : 0, String(govde.plan ?? a.plan).slice(0, 20), String(govde.notlar ?? a.notlar).slice(0, 2000),
      String(govde.ad ?? a.ad).trim().slice(0, 60) || a.ad, a.id).run();
    return json({ ok: true });
  }
  m = yol.match(/^\/api\/yonetici\/gir\/(\d+)$/);
  if (m && req.method === "POST") {
    if (!(await atolyeBul(env, Number(m[1])))) return json({ hata: "Atölye yok" }, 404);
    return json({ ok: true }, 200, { "Set-Cookie": await oturumCerezi(env, { atolye: Number(m[1]), yonetici: true }, url) });
  }
  if (yol === "/api/yonetici/don" && req.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": await oturumCerezi(env, { atolye: 0, yonetici: true }, url) });
  }
  if (yol === "/api/yonetici/bildirim-dene" && req.method === "POST") {
    await ayarYaz(env, SISTEM, "bildirim_son:deneme", "0");
    await bildir(env, "deneme", "Deneme bildirimi: Telegram bağlantısı çalışıyor.");
    await uyariKapat(env, SISTEM, "deneme");
    return json({ ok: true, bildirim: !!(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT) });
  }
  return json({ hata: "Bulunamadı" }, 404);
}

export async function api(req: Request, env: Env, url: URL, ot: Oturum): Promise<Response> {
  const yol = url.pathname;
  const govde = req.method === "POST" ? await req.json<any>().catch(() => ({})) : {};
  if (yol.startsWith("/api/yonetici/")) return yoneticiApi(req, env, url, ot, govde);
  if (yol === "/api/durum") return durum(env, ot, url);
  if (yol === "/api/cikis" && req.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": cerez("oturum", "", 0, url) });
  if (ot.atolye === 0) return json({ hata: "Önce bir atölyeye girin" }, 400);

  let m = yol.match(/^\/api\/hesap\/(\d+)$/);
  if (m && req.method === "POST") {
    const h = await yetkiliHesap(env, ot, m[1]);
    await env.DB.prepare("UPDATE hesaplar SET aktif = ? WHERE id = ?").bind(govde.aktif ? 1 : 0, h.id).run();
    await kaydet(env, ot.atolye, h.id, govde.aktif ? "hesap etkinleştirildi" : "hesap durduruldu");
    return json({ ok: true });
  }
  if (m && req.method === "DELETE") {
    const h = await yetkiliHesap(env, ot, m[1]);
    await hesapSil(env, h.id);
    await kaydet(env, ot.atolye, null, `@${h.kullanici} kaldırıldı; kuralları, kişileri ve istatistikleri silindi`);
    return json({ ok: true });
  }
  m = yol.match(/^\/api\/hesap\/(\d+)\/(paylasimlar|hikayeler|kisiler|ozet)$/);
  if (m) {
    const h = await yetkiliHesap(env, ot, m[1]);
    if (m[2] === "paylasimlar") return paylasimlar(env, h);
    if (m[2] === "hikayeler") return hikayeler(env, h);
    if (m[2] === "kisiler") return kisiler(env, h.id, url);
    const { results } = await env.DB.prepare(
      `SELECT gun, tur, SUM(adet) AS adet FROM istatistik
       WHERE kural IN (SELECT id FROM kurallar WHERE hesap = ?) AND gun >= ? GROUP BY gun, tur`,
    ).bind(h.id, trGun(Date.now() - 30 * 864e5)).all();
    return json({ bugun: trGun(Date.now()), gunler: results });
  }
  if (yol === "/api/kural" && req.method === "POST") return kuralKaydet(env, ot, govde);
  m = yol.match(/^\/api\/kural\/(\d+)$/);
  if (m && req.method === "DELETE") {
    const k = await yetkiliKural(env, ot, Number(m[1]));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM kurallar WHERE id = ?").bind(k.id),
      env.DB.prepare("DELETE FROM istatistik WHERE kural = ?").bind(k.id),
      env.DB.prepare("DELETE FROM bekleyen WHERE kural = ?").bind(k.id),
    ]);
    return json({ ok: true });
  }
  if (yol === "/api/sablonlar" && req.method === "POST") {
    for (const ad of Object.keys(VARSAYILAN_AYAR)) if (ad !== "hazir_sorular" && typeof govde[ad] === "string") await ayarYaz(env, ot.atolye, ad, govde[ad].slice(0, 1000));
    return json({ ok: true });
  }
  if (yol === "/api/hazir-sorular" && req.method === "POST") return hazirSorulariKaydet(env, ot, govde.liste);
  if (yol === "/api/simdi" && req.method === "POST") {
    if (!(await sahiplen(env, `simdi:${ot.atolye}:${Math.floor(Date.now() / 6e4)}`))) return json({ hata: "Az önce kontrol edildi; bir dakika bekleyin." }, 429);
    await tara(env, await hesaplar(env, ot.atolye));
    return json({ ok: true });
  }
  if (yol === "/api/gonderiler") return gonderiler(env, ot);
  if (yol === "/api/gonderi" && req.method === "POST") return gonderiKaydet(env, ot, govde);
  m = yol.match(/^\/api\/gonderi\/(\d+)$/);
  if (m && req.method === "DELETE") {
    const g = await gonderiBul(env, ot, Number(m[1]));
    if (g.durum === "yayinda") return json({ hata: "Yayınlanmış gönderi silinemez; Instagram'dan kaldırın." }, 400);
    await env.DB.prepare("UPDATE gonderiler SET durum = 'iptal' WHERE id = ?").bind(g.id).run();
    if (env.VIDEO) await env.VIDEO.delete(g.dosya).catch(() => {});
    await kaydet(env, ot.atolye, g.hesap, `gönderi #${g.id} iptal edildi`);
    return json({ ok: true });
  }
  m = yol.match(/^\/api\/gonderi\/(\d+)\/yeniden$/);
  if (m && req.method === "POST") {
    const g = await gonderiBul(env, ot, Number(m[1]));
    if (g.durum !== "hata") return json({ hata: "Yalnızca başarısız gönderi yeniden denenir." }, 400);
    if (env.VIDEO && !(await env.VIDEO.head(g.dosya))) return json({ hata: "Video artık depoda yok; gönderiyi yeniden oluşturun." }, 400);
    await env.DB.prepare("UPDATE gonderiler SET durum = 'bekliyor', deneme = 0, hata = NULL, konteyner = NULL, zaman = ? WHERE id = ?").bind(Math.max(g.zaman, Date.now()), g.id).run();
    return json({ ok: true });
  }
  if (yol === "/api/video" && req.method === "PUT") return videoYukle(req, env, ot.atolye, url);
  if (yol === "/api/atolye" && req.method === "POST") {
    const ad = String(govde.ad ?? "").trim().slice(0, 60);
    if (!ad) return json({ hata: "Ad boş olamaz" }, 400);
    await env.DB.prepare("UPDATE atolyeler SET ad = ? WHERE id = ?").bind(ad, ot.atolye).run();
    return json({ ok: true });
  }
  if (yol === "/api/atolye/anahtar" && req.method === "POST") {
    const anahtar = yeniAnahtar();
    await env.DB.prepare("UPDATE atolyeler SET anahtar = ? WHERE id = ?").bind(anahtar, ot.atolye).run();
    await kaydet(env, ot.atolye, null, "API anahtarı yenilendi; eski anahtar geçersiz");
    return json({ ok: true, anahtar });
  }
  m = yol.match(/^\/api\/uyari\/([\w:.-]+)$/);
  if (m && req.method === "DELETE") {
    await uyariKapat(env, ot.atolye, decodeURIComponent(m[1]));
    return json({ ok: true });
  }
  return json({ hata: "Bulunamadı" }, 404);
}

// --- Giriş noktaları ------------------------------------------------------------------
async function yonlendirici(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const yol = url.pathname;
  if (yol === "/favicon.ico") return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
  if (yol === "/webhook") return webhook(req, env, ctx);
  if (yol === "/oauth") return oauth(req, env, url);
  if (yol === "/giris/instagram") return oauthBaslat(env, url, "giris", 0);
  if (yol === "/baglan") {
    const ot = await oturumOku(req, env);
    if (!ot || !ot.atolye) return yonlendir(`${url.origin}/`);
    return oauthBaslat(env, url, "bagla", ot.atolye);
  }
  if (yol === "/meta/deauthorize" && req.method === "POST") return metaGeriCagri(req, env, url, "deauthorize");
  if (yol === "/meta/veri-silme" && req.method === "POST") return metaGeriCagri(req, env, url, "veri-silme");
  const l = yol.match(/^\/l\/([a-z0-9]{4,16})\/?$/);
  if (l) return linkYonlendir(req, env, l[1], ctx);
  const v = yol.match(/^\/v\/(\d+\/[0-9a-f-]{36}\.mp4)$/);
  if (v) return videoSun(req, env, v[1]);

  // Yönetici girişi (şifre)
  if (yol === "/giris" && req.method === "POST") {
    const ip = await ozet("g", req.headers.get("CF-Connecting-IP") ?? "-");
    if (await girisKilitli(env, ip)) return yonlendir(`${url.origin}/?hata=2`);
    const sifre = String((await req.formData()).get("sifre") ?? "");
    if (!env.PANEL_SIFRE || !esit(await hmac("giris", sifre), await hmac("giris", env.PANEL_SIFRE))) {
      await girisBasarisiz(env, ip);
      return yonlendir(`${url.origin}/?hata=1`);
    }
    await girisBasarili(env, ip);
    return yonlendir(`${url.origin}/`, { "Set-Cookie": await oturumCerezi(env, { atolye: 0, yonetici: true }, url) });
  }
  if (yol === "/cikis") return yonlendir(`${url.origin}/`, { "Set-Cookie": cerez("oturum", "", 0, url) });

  // Herkese açık sayfalar
  if (yol === "/gizlilik") return html(GIZLILIK(env));
  if (yol === "/kosullar") return html(KOSULLAR(env));
  if (yol === "/veri-silme") {
    const kod = url.searchParams.get("kod") ?? "";
    let sonuc: { zaman: number; bulundu: boolean } | null = null;
    if (/^[0-9a-f]{10}$/.test(kod)) {
      const v = (await ayarlar(env, SISTEM))[`silme:${kod}`];
      if (v) try { sonuc = JSON.parse(v); } catch { /* yok say */ }
    }
    return html(VERI_SILME(env, kod, sonuc));
  }

  // Dış API: Bearer <atölye anahtarı>
  if (yol.startsWith("/api/disari/") || yol === "/mcp" || yol.startsWith("/mcp/")) {
    const yoldaki = yol.match(/^\/mcp\/([A-Za-z0-9]{16,})\/?$/)?.[1];
    const verilen = yoldaki ?? req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const atolye = await anahtarlaAtolye(env, verilen);
    if (!atolye) return json({ hata: "Anahtar geçersiz" }, 401);
    if (!atolye.aktif) return json({ hata: "Atölye durdurulmuş" }, 403);
    const ot: Oturum = { atolye: atolye.id, yonetici: false };
    if (yol === "/api/disari/kural" && req.method === "POST") return disKural(env, atolye, await req.json<any>().catch(() => ({})));
    if (yol === "/api/disari/video" && req.method === "PUT") return videoYukle(req, env, atolye.id, url);
    if (yol.startsWith("/mcp")) {
      return mcp(req, env, atolye, (yontem, apiYolu, govde) => {
        const u = new URL(apiYolu, url.origin);
        const r = new Request(u, { method: yontem, headers: { "Content-Type": "application/json" }, body: govde === undefined ? null : JSON.stringify(govde) });
        return api(r, env, u, ot).then((c) => c.json());
      });
    }
    return json({ hata: "Bulunamadı" }, 404);
  }

  if (yol.startsWith("/api/")) {
    const ot = await oturumOku(req, env);
    if (!ot) return json({ hata: "Giriş gerekli" }, 401);
    try {
      return await api(req, env, url, ot);
    } catch (e) {
      if (e instanceof HttpHata) return json({ hata: e.message }, e.durum);
      throw e;
    }
  }
  if (yol === "/") {
    const ot = await oturumOku(req, env);
    if (ot) return html(PANEL.replaceAll("{{URUN_ADI}}", urunAdi(env)));
    return html(SITE.replaceAll("{{URUN_ADI}}", urunAdi(env)).replaceAll("{{ILETISIM}}", env.ILETISIM ?? "").replaceAll("{{BETA}}", env.KAPALI_BETA === "1" ? "1" : "0"));
  }
  return new Response("Bulunamadı", { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await yonlendirici(req, env, ctx);
    } catch (e) {
      console.error(e);
      await kaydet(env, SISTEM, null, `istek hatası ${new URL(req.url).pathname}: ${(e as Error).message}`).catch(() => {});
      return json({ hata: "Sunucu hatası: " + (e as Error).message }, 500);
    }
  },

  async scheduled(olay: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(olay.cron === "0 4 * * 1" ? tokenYenile(env) : yokla(env));
  },
} satisfies ExportedHandler<Env>;
