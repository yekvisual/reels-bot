// D1 yardımcıları

export interface Env {
  DB: D1Database;
  APP_SECRET: string;   // Meta panelindeki Instagram app secret (webhook imzası)
  VERIFY_TOKEN: string; // Meta panelindeki webhook doğrulama anahtarı
  PANEL_SIFRE: string;
  OTOMASYON_ANAHTARI?: string; // publish.py'nin /api/disari/kural için Bearer anahtarı
  TELEGRAM_TOKEN?: string;     // hata bildirimi: BotFather'dan alınan bot anahtarı
  TELEGRAM_CHAT?: string;      // bildirimin gideceği sohbet kimliği
  HEALTHCHECK_URL?: string;    // her dakikalık iş sonunda ping (healthchecks.io); kesilirse onlar haber verir
  INSTAGRAM_APP_ID?: string;   // panelden Instagram girişiyle hesap bağlamak için (boşsa yalnız anahtar yapıştırma)
  LINK_KOK?: string;           // "https://yeklab.com.tr/l"
  SITE_KOK?: string;           // CORS için site adresi
  DENEME?: string;
}

export interface Hesap { id: string; kullanici: string; token: string; token_yenilendi: number; aktif: number }

export interface Kural {
  id: number; hesap: string; medya: string; anahtar: string; baslik: string; icerik: string;
  takip_sart: number; yorum_yaniti: number; aktif: number; olusturma: number;
}

export interface HazirSoru { soru: string; tur: "son" | "metin"; cevap: string }

export const VARSAYILAN_AYAR: Record<string, string> = {
  ilk_buton: "Merhaba! {baslik} için linkleri hemen göndereyim. @{kullanici} hesabını takip edip aşağıdaki butona basmanız yeterli.",
  ilk_metin: "Merhaba, {baslik} için linkleri hemen göndereyim. @{kullanici} hesabını takip edip bu mesaja \"tamam\" yazmanız yeterli.",
  takip_iste: "{baslik} için linkleri hemen göndereyim. @{kullanici} hesabını takip edip butona basmanız yeterli.",
  takip_yok: "Takibinizi henüz göremiyorum. @{kullanici} hesabını takip ettikten sonra butona tekrar basın.",
  teslim: "{baslik} için linkler:\n\n{icerik}\n\nDenerseniz sonucu merak ediyorum.",
  buton_link: "Linki gönder",
  buton_takip: "Takip ettim",
  yorum_yanitlari: "DM'den gönderdim 📩\nGelen kutunuza bakın 📩\nGönderdim, DM'nize bakın 🙌",
  veri_silindi: "Hakkınızda tuttuğumuz kayıtlar silindi.",
  hikaye_tesekkur: "Hikâyede andığınız için teşekkürler! 🙌",
  // Yoruma özel yanıtta buton belgelenmemiş; ilk denemede reddedilirse kendiliğinden 0 olur
  ozel_yanit_buton: "1",
  // Hazır sorular (ice breakers): JSON [{soru, tur: "son"|"metin", cevap}]
  hazir_sorular: "[]",
};

export async function ayarlar(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT ad, deger FROM ayarlar").all<{ ad: string; deger: string }>();
  return { ...VARSAYILAN_AYAR, ...Object.fromEntries(results.map((r) => [r.ad, r.deger])) };
}

export async function ayarYaz(env: Env, ad: string, deger: string) {
  await env.DB.prepare("INSERT INTO ayarlar (ad, deger) VALUES (?, ?) ON CONFLICT (ad) DO UPDATE SET deger = excluded.deger")
    .bind(ad, deger).run();
}

export function hazirSorular(ayar: Record<string, string>): HazirSoru[] {
  try {
    const v = JSON.parse(ayar.hazir_sorular);
    return Array.isArray(v) ? v.slice(0, 4) : [];
  } catch {
    return [];
  }
}

export async function ozet(...parca: string[]): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parca.join("|")));
  return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Olayı sahiplenir; başka bir çalıştırma (cron/webhook) aynı olayı işliyorsa false döner. */
export async function sahiplen(env: Env, oz: string): Promise<boolean> {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO islenen (ozet, zaman) VALUES (?, ?)").bind(oz, Date.now()).run();
  return r.meta.changes > 0;
}

export async function birak(env: Env, oz: string) {
  await env.DB.prepare("DELETE FROM islenen WHERE ozet = ?").bind(oz).run();
}

/** Başarısız denemeyi sayar, toplam sayıyı döner. */
export async function denemeSay(env: Env, oz: string): Promise<number> {
  const r = await env.DB.prepare(
    "INSERT INTO deneme (ozet, adet, zaman) VALUES (?, 1, ?) ON CONFLICT (ozet) DO UPDATE SET adet = adet + 1, zaman = excluded.zaman RETURNING adet",
  ).bind(oz, Date.now()).first<number>("adet");
  return r ?? 1;
}

const GIRIS_PENCERE = 15 * 6e4;
const GIRIS_SINIR = 5;

/** Bu IP'den son 15 dakikada 5+ yanlış şifre girildiyse true. */
export async function girisKilitli(env: Env, ip: string): Promise<boolean> {
  const r = await env.DB.prepare("SELECT adet, zaman FROM giris_deneme WHERE ip = ?").bind(ip).first<{ adet: number; zaman: number }>();
  return !!r && r.adet >= GIRIS_SINIR && Date.now() - r.zaman < GIRIS_PENCERE;
}

export async function girisBasarisiz(env: Env, ip: string) {
  await env.DB.prepare(
    `INSERT INTO giris_deneme (ip, adet, zaman) VALUES (?, 1, ?)
     ON CONFLICT (ip) DO UPDATE SET adet = CASE WHEN excluded.zaman - zaman > ? THEN 1 ELSE adet + 1 END, zaman = excluded.zaman`,
  ).bind(ip, Date.now(), GIRIS_PENCERE).run();
}

export async function girisBasarili(env: Env, ip: string) {
  await env.DB.prepare("DELETE FROM giris_deneme WHERE ip = ?").bind(ip).run();
}

// --- Kişiler ---------------------------------------------------------------------------
export async function kisiKaydet(env: Env, hesap: string, igsid: string, kaynak: string, kullanici?: string | null, ad?: string | null) {
  const simdi = Date.now();
  await env.DB.prepare(
    `INSERT INTO kisiler (hesap, igsid, kullanici, ad, ilk, son, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (hesap, igsid) DO UPDATE SET son = excluded.son,
       kullanici = COALESCE(excluded.kullanici, kullanici), ad = COALESCE(excluded.ad, ad)`,
  ).bind(hesap, igsid, kullanici ?? null, ad ?? null, simdi, simdi, kaynak).run();
}

export async function kisiVar(env: Env, hesap: string, igsid: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 AS v FROM kisiler WHERE hesap = ? AND igsid = ?").bind(hesap, igsid).first("v"));
}

export async function kisiTakip(env: Env, hesap: string, igsid: string, takipci: boolean) {
  await env.DB.prepare("UPDATE kisiler SET takipci = ? WHERE hesap = ? AND igsid = ?").bind(takipci ? 1 : 0, hesap, igsid).run();
}

export async function teslimKaydet(env: Env, hesap: string, igsid: string, kural: number) {
  await env.DB.prepare("INSERT INTO teslimler (hesap, igsid, kural, zaman) VALUES (?, ?, ?, ?)").bind(hesap, igsid, kural, Date.now()).run();
}

/** Kişiye ait tüm kayıtları siler ("verilerimi sil"). */
export async function kisiSil(env: Env, hesap: string, igsid: string, kisiOz: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bekleyen WHERE hesap = ? AND kisi = ?").bind(hesap, kisiOz),
    env.DB.prepare("DELETE FROM kisiler WHERE hesap = ? AND igsid = ?").bind(hesap, igsid),
    env.DB.prepare("DELETE FROM teslimler WHERE hesap = ? AND igsid = ?").bind(hesap, igsid),
  ]);
}

// --- Linkler ---------------------------------------------------------------------------
const URL_DESENI = /https?:\/\/[^\s<>"')\]]+/g;

/** İçerikteki linkleri kısa kodlu sayaç linkleriyle değiştirir; LINK_KOK yoksa olduğu gibi döner. */
export async function linkleriKisalt(env: Env, kural: number, icerik: string): Promise<string> {
  const kok = env.LINK_KOK?.replace(/\/$/, "");
  if (!kok) return icerik;
  const eslesmeler = [...new Set(icerik.match(URL_DESENI) ?? [])];
  if (!eslesmeler.length) return icerik;
  const ciftler: [string, string][] = [];
  for (const url of eslesmeler) ciftler.push([url, (await ozet("l", String(kural), url)).slice(0, 7)]);
  await env.DB.batch(ciftler.map(([url, kod]) =>
    env.DB.prepare("INSERT OR IGNORE INTO linkler (kod, kural, url) VALUES (?, ?, ?)").bind(kod, kural, url)));
  let out = icerik;
  for (const [url, kod] of ciftler) out = out.replaceAll(url, `${kok}/${kod}`);
  return out;
}

export async function linkBul(env: Env, kod: string): Promise<{ kural: number; url: string } | null> {
  return env.DB.prepare("SELECT kural, url FROM linkler WHERE kod = ?").bind(kod).first<{ kural: number; url: string }>();
}

export async function tiklamaSay(env: Env, kod: string, kural: number) {
  const gun = trGun(Date.now());
  await env.DB.batch([
    env.DB.prepare("INSERT INTO link_tiklama (kod, gun, adet) VALUES (?, ?, 1) ON CONFLICT (kod, gun) DO UPDATE SET adet = adet + 1").bind(kod, gun),
    env.DB.prepare("INSERT INTO istatistik (kural, gun, tur, adet) VALUES (?, ?, 'tiklama', 1) ON CONFLICT (kural, gun, tur) DO UPDATE SET adet = adet + 1").bind(kural, gun),
  ]);
}

// --- Bildirim ---------------------------------------------------------------------------
const BILDIRIM_ARA = 6 * 36e5;

/** Aynı türden bildirim 6 saatte bir: Telegram'a gönderir, panelde kırmızı şerit için ayarlara yazar. */
export async function bildir(env: Env, tur: string, metin: string) {
  const ayar = await ayarlar(env);
  const son = Number(ayar[`bildirim_son:${tur}`] ?? 0);
  await ayarYaz(env, `uyari:${tur}`, JSON.stringify({ zaman: Date.now(), metin }));
  if (Date.now() - son < BILDIRIM_ARA) return;
  await ayarYaz(env, `bildirim_son:${tur}`, String(Date.now()));
  await kaydet(env, null, `⚠ ${metin}`);
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT, text: `YEK Lab DM · ${metin}`, disable_web_page_preview: true }),
    });
    if (!r.ok) await kaydet(env, null, `Telegram bildirimi gönderilemedi (${r.status})`);
  } catch (e) {
    await kaydet(env, null, `Telegram bildirimi gönderilemedi: ${(e as Error).message}`);
  }
}

/** Son 24 saatin uyarıları (panelde şerit). */
export function uyarilar(ayar: Record<string, string>): { tur: string; zaman: number; metin: string }[] {
  const out: { tur: string; zaman: number; metin: string }[] = [];
  for (const [ad, deger] of Object.entries(ayar)) {
    if (!ad.startsWith("uyari:")) continue;
    try {
      const v = JSON.parse(deger);
      if (Date.now() - v.zaman < 864e5) out.push({ tur: ad.slice(6), ...v });
    } catch { /* bozuk kayıt */ }
  }
  return out.sort((a, b) => b.zaman - a.zaman);
}

/** Türkiye saatiyle gün (UTC+3, yaz saati yok): panelde "bugün" gece yarısı değişsin */
export const trGun = (ms: number) => new Date(ms + 3 * 36e5).toISOString().slice(0, 10);

export async function say(env: Env, kural: number, tur: string) {
  const gun = trGun(Date.now());
  await env.DB.prepare(
    "INSERT INTO istatistik (kural, gun, tur, adet) VALUES (?, ?, ?, 1) ON CONFLICT (kural, gun, tur) DO UPDATE SET adet = adet + 1",
  ).bind(kural, gun, tur).run();
}

export async function kaydet(env: Env, hesap: string | null, metin: string) {
  console.log(`[${hesap ?? "-"}] ${metin}`);
  await env.DB.prepare("INSERT INTO kayit (zaman, hesap, metin) VALUES (?, ?, ?)").bind(Date.now(), hesap, metin.slice(0, 500)).run();
}

/** Eski kayıtları temizler (saatte bir çağrılır). */
export async function temizle(env: Env) {
  const simdi = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM kayit WHERE id <= (SELECT MAX(id) FROM kayit) - 1000"),
    env.DB.prepare("DELETE FROM islenen WHERE zaman < ?").bind(simdi - 30 * 864e5),
    env.DB.prepare("DELETE FROM bekleyen WHERE zaman < ?").bind(simdi - 7 * 864e5),
    env.DB.prepare("DELETE FROM deneme WHERE zaman < ?").bind(simdi - 30 * 864e5),
    env.DB.prepare("DELETE FROM giris_deneme WHERE zaman < ?").bind(simdi - 864e5),
    env.DB.prepare("DELETE FROM teslimler WHERE zaman < ?").bind(simdi - 365 * 864e5),
    env.DB.prepare("DELETE FROM kisiler WHERE son < ?").bind(simdi - 365 * 864e5),
  ]);
}
