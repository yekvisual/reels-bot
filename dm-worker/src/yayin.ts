// Planlı gönderiler: video R2'de bekler; zamanı gelince Instagram konteyneri açılır, işlenince yayınlanır,
// ardından yorum→DM kuralı kendiliğinden kurulur. Her dakika cron'dan çağrılır.

import { Env, Gonderi, Hesap, Kural, bildir, hesapBul, kaydet } from "./db";
import { IG } from "./ig";

const ADIM_ZAMAN_ASIMI = 45 * 6e4;  // konteyner 45 dakikada işlenmediyse yeniden denenir
const EN_COK_DENEME = 3;
const SEFERDE = 4;                    // bir cron çalışmasında işlenecek gönderi (alt-istek sınırı için)
export const EN_BUYUK_VIDEO = 100 * 1024 * 1024; // Cloudflare istek gövdesi sınırı: ücretsiz/Pro 100 MB (Business 500 MB)
export const EN_UZUN_ACIKLAMA = 2200;
export const PAYLASIM_IZNI = "instagram_business_content_publish";

/** Videonun Instagram'ın indireceği herkese açık adresi: R2 anahtarı tahmin edilemez (uuid). */
export const videoAdresi = (env: Env, dosya: string) => `${(env.KOK ?? "").replace(/\/$/, "")}/v/${dosya}`;

function hesapIzinliMi(h: Hesap): boolean {
  // İzin listesi boşsa (anahtar elle yapıştırılmış) bilinmiyor: denenir, Meta reddederse "yeniden bağla" uyarısı çıkar
  return !h.izinler || h.izinler.split(",").includes(PAYLASIM_IZNI);
}

async function durumYaz(env: Env, g: Gonderi, alanlar: Partial<Gonderi>) {
  const anahtarlar = Object.keys(alanlar);
  if (!anahtarlar.length) return;
  await env.DB.prepare(`UPDATE gonderiler SET ${anahtarlar.map((k) => `${k} = ?`).join(", ")}, adim_zamani = ? WHERE id = ?`)
    .bind(...anahtarlar.map((k) => (alanlar as any)[k]), Date.now(), g.id).run();
}

const IZIN_HATASI = /\(kod (10|190|200)[)/]|permission|OAuthException/i;

/** Durum geçişini yalnızca beklenen durumdaysa yapar (cron ile panel aynı anda çalışsa da bir gönderi iki kez yayınlanmaz). */
async function sahiplenDurum(env: Env, g: Gonderi, beklenen: string, yeni: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE gonderiler SET durum = ?, adim_zamani = ? WHERE id = ? AND durum = ?").bind(yeni, Date.now(), g.id, beklenen).run();
  return r.meta.changes > 0;
}

async function basarisiz(env: Env, g: Gonderi, hata: string, kalici = false) {
  const deneme = g.deneme + 1;
  if (!kalici && deneme < EN_COK_DENEME) {
    // Her denemede 5 dakika daha bekler: kısa Instagram kesintileri gönderiyi düşürmesin
    await durumYaz(env, g, { durum: "bekliyor", konteyner: null, hata, deneme, zaman: Date.now() + deneme * 5 * 6e4 });
    await kaydet(env, g.atolye, g.hesap, `gönderi #${g.id} ${deneme}. denemede başarısız, ${deneme * 5} dk sonra yeniden denenecek: ${hata}`);
    return;
  }
  await durumYaz(env, g, { durum: "hata", hata, deneme });
  await kaydet(env, g.atolye, g.hesap, `gönderi #${g.id} yayınlanamadı: ${hata}`);
  const izin = IZIN_HATASI.test(hata);
  await bildir(env, `gonderi:${g.id}`, izin
    ? `"${g.aciklama.split("\n")[0].slice(0, 50)}" gönderisi yayınlanamadı: Instagram paylaşım izni vermedi. Ayarlar → Hesaplar'dan hesabı yeniden bağlayın, sonra gönderiyi yeniden deneyin.`
    : `"${g.aciklama.split("\n")[0].slice(0, 50)}" gönderisi yayınlanamadı: ${hata}`, g.atolye);
}

async function konteynerAc(env: Env, g: Gonderi, hesap: Hesap) {
  if (!env.KOK) return basarisiz(env, g, "KOK tanımlı değil (wrangler.toml): video adresi üretilemiyor", true);
  if (!hesapIzinliMi(hesap)) return basarisiz(env, g, "hesapta paylaşım izni yok (permission); hesabı yeniden bağlayın", true);
  if (!(await sahiplenDurum(env, g, "bekliyor", "isleniyor"))) return; // başka bir çalıştırma aldı
  if (env.DENEME === "1") {
    const medya = `deneme-${g.id}`;
    await durumYaz(env, g, { durum: "yayinda", yayin: Date.now(), medya, hata: null });
    await kaydet(env, g.atolye, g.hesap, `[deneme] gönderi #${g.id} yayınlanmış sayıldı`);
    return kuralKur(env, g, medya, false);
  }
  try {
    const r = await new IG(hesap.token).post(`${hesap.id}/media`, {
      media_type: "REELS", video_url: videoAdresi(env, g.dosya), caption: g.aciklama, share_to_feed: g.feed ? "true" : "false",
    });
    await durumYaz(env, g, { konteyner: String(r.id), hata: null });
    await kaydet(env, g.atolye, g.hesap, `gönderi #${g.id} Instagram'a verildi, işleniyor`);
  } catch (e) {
    const m = (e as Error).message;
    await basarisiz(env, g, m, IZIN_HATASI.test(m));
  }
}

async function yayinla(env: Env, g: Gonderi, hesap: Hesap) {
  const ig = new IG(hesap.token);
  let durum: any;
  try {
    durum = await ig.get(g.konteyner!, { fields: "status_code,status" });
  } catch (e) {
    return basarisiz(env, g, `konteyner durumu okunamadı: ${(e as Error).message}`);
  }
  if (durum.status_code === "IN_PROGRESS") {
    if (Date.now() - g.adim_zamani > ADIM_ZAMAN_ASIMI) await basarisiz(env, g, "Instagram videoyu 45 dakikada işlemedi");
    return;
  }
  if (durum.status_code !== "FINISHED") return basarisiz(env, g, `Instagram videoyu kabul etmedi: ${durum.status ?? durum.status_code}`);
  if (!(await sahiplenDurum(env, g, "isleniyor", "yayinlaniyor"))) return; // başka bir çalıştırma yayınlıyor
  let medya: string;
  try {
    medya = String((await ig.post(`${hesap.id}/media_publish`, { creation_id: g.konteyner })).id);
  } catch (e) {
    const m = (e as Error).message;
    // Yayın adımı başarısızsa konteyner yeniden kullanılamaz; baştan denenir
    await basarisiz(env, g, `yayınlama: ${m}`, IZIN_HATASI.test(m));
    return;
  }
  // Buradan sonra Instagram'da yayın var: ne olursa olsun yeniden denenmez
  let kalici: string | null = null;
  try {
    kalici = (await ig.get(medya, { fields: "permalink" })).permalink ?? null;
  } catch { /* adres sonra paylaşımlar listesinden görünür */ }
  await durumYaz(env, g, { durum: "yayinda", medya, kalici, yayin: Date.now(), hata: null });
  await kaydet(env, g.atolye, g.hesap, `gönderi #${g.id} yayınlandı${kalici ? ": " + kalici : ""}`).catch(() => {});
  await kuralKur(env, g, medya).catch(async (e) => kaydet(env, g.atolye, g.hesap, `gönderi #${g.id} kuralı açılamadı: ${(e as Error).message}`).catch(() => {}));
  if (env.VIDEO) await env.VIDEO.delete(g.dosya).catch(() => {});
}

/** Yayın sonrası yorum→DM kuralı: kelime ve içerik verilmişse aktif, yalnız kelime varsa pasif (içerik bekler). */
async function kuralKur(env: Env, g: Gonderi, medya: string, gercek = true) {
  const anahtar = g.kural_anahtar.trim();
  // Açıklamadaki metinle önceden açılmış bir kural varsa ona bağlanır (publish.py akışıyla aynı)
  const { results: bekleyenler } = await env.DB.prepare("SELECT * FROM kurallar WHERE hesap = ? AND medya LIKE 'aciklama:%'").bind(g.hesap).all<Kural>();
  const eski = bekleyenler.find((k) => g.aciklama.includes(k.medya.slice("aciklama:".length)));
  if (!anahtar && !eski) return;
  const icerik = g.kural_icerik.trim() || eski?.icerik || "";
  const aktif = icerik && gercek ? 1 : 0; // deneme modunda sahte paylaşıma bağlı kural pasif kalır
  let kuralId: number;
  if (eski) {
    await env.DB.prepare("UPDATE kurallar SET medya = ?, anahtar = ?, baslik = ?, icerik = ?, aktif = ? WHERE id = ?")
      .bind(medya, anahtar || eski.anahtar, g.kural_baslik.trim() || eski.baslik, icerik, aktif, eski.id).run();
    kuralId = eski.id;
  } else {
    const r = await env.DB.prepare(
      "INSERT INTO kurallar (hesap, medya, anahtar, baslik, icerik, takip_sart, yorum_yaniti, aktif, olusturma) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
    ).bind(g.hesap, medya, anahtar, g.kural_baslik.trim() || anahtar, icerik, g.kural_takip ? 1 : 0, aktif, Date.now()).run();
    kuralId = Number(r.meta.last_row_id);
  }
  await env.DB.prepare("UPDATE gonderiler SET kural = ? WHERE id = ?").bind(kuralId, g.id).run();
  await env.DB.prepare("DELETE FROM medya_sayac WHERE medya = ?").bind(medya).run();
  const ad = anahtar || eski?.anahtar;
  await kaydet(env, g.atolye, g.hesap, aktif ? `gönderi #${g.id} için "${ad}" kuralı açıldı` : `gönderi #${g.id} için "${ad}" kuralı pasif ${eski ? "bağlandı" : "açıldı"}${icerik ? "" : " (içerik yok)"}`);
  if (!icerik) await bildir(env, `kural_eksik:${g.id}`, `"${ad}" kelimesi için gönderilecek içerik girilmedi; Otomasyonlar'dan içerik girip etkinleştirin.`, g.atolye);
}

/** Her dakika: zamanı gelen gönderiler için konteyner açar, işlenenleri yayınlar. */
export async function gonderileriIsle(env: Env) {
  // Durdurulmuş atölyenin gönderileri bekler, yeniden açılınca sürer. "yayinlaniyor" (yarım kalmış yayın adımı) 10 dakika sonra yeniden ele alınır.
  await env.DB.prepare("UPDATE gonderiler SET durum = 'isleniyor' WHERE durum = 'yayinlaniyor' AND adim_zamani < ?").bind(Date.now() - 10 * 6e4).run();
  const { results } = await env.DB.prepare(
    `SELECT g.* FROM gonderiler g JOIN atolyeler a ON a.id = g.atolye
     WHERE a.aktif = 1 AND ((g.durum = 'bekliyor' AND g.zaman <= ?) OR g.durum = 'isleniyor') ORDER BY g.zaman LIMIT ?`,
  ).bind(Date.now(), SEFERDE).all<Gonderi>();
  for (const g of results) {
    const hesap = await hesapBul(env, g.hesap);
    if (!hesap || !hesap.aktif) {
      await basarisiz(env, g, "hesap durdurulmuş ya da kaldırılmış", true);
      continue;
    }
    if (g.durum === "bekliyor") await konteynerAc(env, g, hesap);
    else await yayinla(env, g, hesap);
  }
}

/** Sahipsiz videolar: yüklenmiş ama 2 gün içinde planlanmamış ya da planı bitmiş dosyalar silinir (saatte bir). */
export async function videolariTemizle(env: Env) {
  if (!env.VIDEO) return;
  const liste = await env.VIDEO.list({ limit: 500 });
  for (const o of liste.objects) {
    const g = await env.DB.prepare("SELECT durum, olusturma FROM gonderiler WHERE dosya = ?").bind(o.key).first<{ durum: string; olusturma: number }>();
    const eski = Date.now() - o.uploaded.getTime() > 2 * 864e5;
    if ((!g && eski) || (g && ["yayinda", "iptal"].includes(g.durum)) || (g && g.durum === "hata" && eski && Date.now() - g.olusturma > 14 * 864e5)) {
      await env.VIDEO.delete(o.key).catch(() => {});
    }
  }
}
