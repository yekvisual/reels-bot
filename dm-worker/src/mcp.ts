// Claude ve diğer MCP istemcileri için uzak sunucu (Streamable HTTP, durumsuz). Her atölye kendi anahtarıyla bağlanır:
//   Authorization: Bearer <atölye anahtarı>   ya da   POST /mcp/<anahtar>  (başlık koyamayan istemciler için)
// Araçlar panelin iç API'sine bağlanır; yetki çağıran tarafta doğrulanmıştır.

import { Atolye, Env } from "./db";

type ApiCagir = (yontem: "GET" | "POST" | "DELETE", yol: string, govde?: unknown) => Promise<any>;

const SURUM = "2025-06-18";
const metin = (t: unknown) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 1) }] });
const hata = (t: string) => ({ content: [{ type: "text", text: t }], isError: true });

const HESAP = { type: "string", description: "Instagram kullanıcı adı (ör. yekvisual) ya da hesap kimliği; tek hesap varsa boş bırakılabilir" };

const ARACLAR = [
  {
    name: "durum",
    description: "Atölyenin durumu: bağlı Instagram hesapları (paylaşım izni var mı), uyarılar, bekleyen/yayınlanan gönderi sayıları, şablonlar, hazır sorular, son olaylar.",
    inputSchema: { type: "object", properties: { kayit: { type: "integer", description: "Kaç olay satırı dönsün (varsayılan 20, en çok 80)" } } },
  },
  {
    name: "paylasimlar",
    description: "Hesabın son 30 Instagram paylaşımı; yorum sayısı, bağlı DM kuralı, son 30 günün teslim/özel yanıt sayıları ve link tıklamaları.",
    inputSchema: { type: "object", properties: { hesap: HESAP } },
  },
  {
    name: "kurallar",
    description: "Yorum→DM kurallarını listeler ('aciklama:' ile paylaşım öncesi bağlananlar ve 'hikaye:' kuralları dahil).",
    inputSchema: { type: "object", properties: { hesap: HESAP } },
  },
  {
    name: "kural_kaydet",
    description: "Yeni kural ekler ya da id verilirse günceller. medya: paylaşım kimliği, 'aciklama:<açıklamada geçen metin>' (henüz paylaşılmamış video için) ya da 'hikaye:*' / 'hikaye:<id>'. Yorumda anahtar kelime geçince kişiye içerik DM ile gönderilir.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Güncellenecek kural (boşsa yeni)" },
        hesap: HESAP, medya: { type: "string" },
        anahtar: { type: "string", description: "Virgülle ayrılmış kelimeler, ör. 'flux, link'" },
        baslik: { type: "string", description: "Mesajlarda geçen kısa ad, ör. 'FLUX 3 Klein'" },
        icerik: { type: "string", description: "Gönderilecek metin ve linkler (en çok 1000 karakter)" },
        takip_sart: { type: "boolean", description: "Takip etmeyene önce takip istesin (varsayılan true)" },
        yorum_yaniti: { type: "boolean", description: "Yoruma herkese açık 'DM'den gönderdim' yazsın (varsayılan true)" },
        aktif: { type: "boolean", description: "Varsayılan true" },
      },
      required: ["medya", "baslik"],
    },
  },
  { name: "kural_sil", description: "Bir kuralı istatistikleriyle birlikte siler.", inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  { name: "ozet", description: "Hesabın son 30 günü gün gün: özel yanıt, takip isteği, teslim, tıklama sayıları.", inputSchema: { type: "object", properties: { hesap: HESAP } } },
  {
    name: "kisiler",
    description: "Link isteyen / mesaj yazan kişiler: kullanıcı adı, takip durumu, ilk-son etkileşim, kaç teslim aldığı. Arama ve kural filtresi var.",
    inputSchema: { type: "object", properties: { hesap: HESAP, q: { type: "string", description: "Kullanıcı adı ya da ad araması" }, kural: { type: "integer", description: "Yalnızca bu kuraldan teslim alanlar" } } },
  },
  { name: "hikayeler", description: "Hesabın şu an yayında olan hikâyeleri (hikaye:<id> kuralı yazmak için).", inputSchema: { type: "object", properties: { hesap: HESAP } } },
  {
    name: "gonderiler",
    description: "Planlı, işlenen, yayınlanmış ve başarısız gönderiler (video + açıklama + yayın zamanı + yayın sonrası açılacak DM kuralı).",
    inputSchema: { type: "object", properties: { durum: { type: "string", enum: ["bekliyor", "isleniyor", "yayinda", "hata", "iptal"], description: "Boşsa hepsi" } } },
  },
  {
    name: "video_yukleme_komutu",
    description: "Bir videoyu sisteme yüklemek için çalıştırılacak curl komutunu verir (MCP dosya taşıyamaz). Komut çıktısındaki 'dosya' değeri gonderi_planla'ya verilir.",
    inputSchema: { type: "object", properties: { yol: { type: "string", description: "Videonun bilgisayardaki yolu, ör. /Users/ali/video.mp4" } }, required: ["yol"] },
  },
  {
    name: "gonderi_planla",
    description: "Yüklenmiş videoyu Reels olarak belirtilen zamanda yayınlamak üzere planlar; istenirse yayın sonrası yorum→DM kuralını da kurar. id verilirse bekleyen gönderiyi günceller.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Güncellenecek gönderi (boşsa yeni)" },
        hesap: HESAP,
        dosya: { type: "string", description: "video_yukleme_komutu ile yüklenen dosyanın 'dosya' değeri (yeni gönderide zorunlu)" },
        aciklama: { type: "string", description: "Paylaşım açıklaması (en çok 2200 karakter)" },
        zaman: { type: "string", description: "Yayın zamanı, ISO 8601 (ör. 2026-11-07T19:00:00+03:00)" },
        feed: { type: "boolean", description: "Akışta da görünsün (varsayılan true)" },
        kural_anahtar: { type: "string", description: "Yorumda bu kelime(ler) geçince DM gitsin (virgülle). Boşsa kural açılmaz." },
        kural_baslik: { type: "string" }, kural_icerik: { type: "string", description: "DM ile gönderilecek metin ve linkler" },
        kural_takip: { type: "boolean", description: "Takip şartı (varsayılan true)" },
      },
      required: ["aciklama", "zaman"],
    },
  },
  { name: "gonderi_iptal", description: "Bekleyen ya da başarısız gönderiyi iptal eder ve videoyu siler.", inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  { name: "gonderi_yeniden", description: "Başarısız gönderiyi yeniden kuyruğa alır.", inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  {
    name: "hazir_sorular_yaz",
    description: "DM açılışında görünen hazır soruları (en çok 4) atölyenin tüm hesaplarına yazar. tur 'son' = en yeni paylaşımın linkini gönderir, 'metin' = cevap metnini gönderir. Boş liste soruları kaldırır.",
    inputSchema: {
      type: "object",
      properties: { liste: { type: "array", items: { type: "object", properties: { soru: { type: "string" }, tur: { type: "string", enum: ["son", "metin"] }, cevap: { type: "string" } }, required: ["soru", "tur"] } } },
      required: ["liste"],
    },
  },
  {
    name: "sablonlar_yaz",
    description: "Mesaj şablonlarını günceller (takip isteği, teslim metni, hikâye teşekkürü vb.). Önce 'durum' ile mevcut anahtarları gör; yalnızca verilen alanlar değişir. Değişkenler: {baslik}, {icerik}, {kullanici}.",
    inputSchema: { type: "object", properties: { sablonlar: { type: "object", additionalProperties: { type: "string" } } }, required: ["sablonlar"] },
  },
  { name: "simdi_tara", description: "Dakikalık yorum taramasını ve gönderi kuyruğunu beklemeden hemen çalıştırır.", inputSchema: { type: "object", properties: {} } },
];

async function hesapBul(api: ApiCagir, verilen: string | undefined): Promise<string> {
  const v = String(verilen ?? "").trim().replace(/^@/, "");
  const { hesaplar } = await api("GET", "/api/durum");
  if (!v && hesaplar.length === 1) return hesaplar[0].id;
  if (!v) throw new Error(`Hangi hesap? Bağlı hesaplar: ${hesaplar.map((x: any) => "@" + x.kullanici).join(", ") || "yok"}`);
  const h = hesaplar.find((x: any) => x.id === v || x.kullanici.toLowerCase() === v.toLowerCase());
  if (!h) throw new Error(`Hesap bulunamadı: ${verilen}. Bağlı hesaplar: ${hesaplar.map((x: any) => "@" + x.kullanici).join(", ") || "yok"}`);
  return h.id;
}

const zamanISO = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

async function aracCagir(env: Env, atolye: Atolye, api: ApiCagir, ad: string, a: any) {
  switch (ad) {
    case "durum": {
      const d = await api("GET", "/api/durum");
      const n = Math.min(Math.max(Number(a.kayit ?? 20), 0), 80);
      return metin({
        atolye: { id: atolye.id, ad: d.atolye?.ad, plan: d.atolye?.plan },
        hesaplar: d.hesaplar.map((h: any) => ({ id: h.id, kullanici: h.kullanici, aktif: !!h.aktif, paylasim_izni: h.paylasim_izni, baglanti_yenilendi: zamanISO(h.token_yenilendi) })),
        uyarilar: d.uyarilar, son_webhook: zamanISO(d.son_webhook), deneme_modu: d.deneme, video_depolama: d.video, link_kok: d.link_kok,
        gonderi: d.gonderi, sablonlar: d.sablonlar, hazir_sorular: d.hazir_sorular,
        kayit: d.kayit.slice(0, n).map((k: any) => ({ zaman: zamanISO(k.zaman), hesap: k.hesap, metin: k.metin })),
      });
    }
    case "paylasimlar": {
      const id = await hesapBul(api, a.hesap);
      const p = await api("GET", `/api/hesap/${id}/paylasimlar`);
      const sayi = (kural: number, tur: string) => p.sayilar.find((s: any) => s.kural === kural && s.tur === tur)?.adet ?? 0;
      const liste = p.medya.map((m: any) => {
        const kural = p.kurallar.find((k: any) => k.medya === m.id);
        return {
          id: m.id, zaman: m.timestamp, tur: m.media_type, yorum: m.comments_count, link: m.permalink, aciklama: (m.caption ?? "").slice(0, 120),
          kural: kural ? {
            id: kural.id, anahtar: kural.anahtar, baslik: kural.baslik, aktif: !!kural.aktif,
            ozel_yanit: sayi(kural.id, "ozel_yanit"), takip_istegi: sayi(kural.id, "takip_istendi"), teslim: sayi(kural.id, "teslim"),
            tiklama: p.linkler.filter((l: any) => l.kural === kural.id).map((l: any) => ({ url: l.url, kod: l.kod, adet: l.adet })),
          } : null,
        };
      });
      const bagsiz = p.kurallar.filter((k: any) => !p.medya.some((m: any) => m.id === k.medya));
      return metin({ paylasimlar: liste, paylasim_disi_kurallar: bagsiz, hata: p.hata });
    }
    case "kurallar": {
      const d = await api("GET", "/api/durum");
      const hedef = a.hesap ? [await hesapBul(api, a.hesap)] : d.hesaplar.map((h: any) => h.id);
      const sonuc: any[] = [];
      for (const id of hedef) {
        const p = await api("GET", `/api/hesap/${id}/paylasimlar`);
        const h = d.hesaplar.find((x: any) => x.id === id);
        for (const k of p.kurallar) sonuc.push({ hesap: "@" + h.kullanici, ...k, aktif: !!k.aktif, takip_sart: !!k.takip_sart, yorum_yaniti: !!k.yorum_yaniti });
      }
      return metin(sonuc);
    }
    case "kural_kaydet": {
      const id = await hesapBul(api, a.hesap);
      const r = await api("POST", "/api/kural", {
        id: a.id, hesap: id, medya: a.medya, anahtar: a.anahtar ?? "", baslik: a.baslik, icerik: a.icerik ?? "",
        takip_sart: a.takip_sart ?? true, yorum_yaniti: a.yorum_yaniti ?? true, aktif: a.aktif ?? true,
      });
      return r.hata ? hata(r.hata) : metin(a.id ? `Kural ${a.id} güncellendi.` : "Kural eklendi.");
    }
    case "kural_sil": {
      const r = await api("DELETE", `/api/kural/${Number(a.id)}`);
      return r.hata ? hata(r.hata) : metin(`Kural ${a.id} silindi.`);
    }
    case "ozet": return metin(await api("GET", `/api/hesap/${await hesapBul(api, a.hesap)}/ozet`));
    case "kisiler": {
      const id = await hesapBul(api, a.hesap);
      const qs = new URLSearchParams();
      if (a.q) qs.set("q", String(a.q));
      if (a.kural) qs.set("kural", String(a.kural));
      const r = await api("GET", `/api/hesap/${id}/kisiler?${qs}`);
      return metin({
        toplam: r.toplam,
        kisiler: r.kisiler.map((k: any) => ({
          kullanici: k.kullanici, ad: k.ad, takipci: !!k.takipci, kaynak: k.kaynak, teslim: k.teslim, linkler: k.basliklar, ilk: zamanISO(k.ilk), son: zamanISO(k.son),
        })),
      });
    }
    case "hikayeler": return metin(await api("GET", `/api/hesap/${await hesapBul(api, a.hesap)}/hikayeler`));
    case "gonderiler": {
      const r = await api("GET", "/api/gonderiler");
      const liste = r.gonderiler.filter((g: any) => !a.durum || g.durum === a.durum).map((g: any) => ({
        id: g.id, hesap: g.hesap, durum: g.durum, zaman: zamanISO(g.zaman), yayin: zamanISO(g.yayin), video: g.ad, boyut_mb: Math.round(g.boyut / 1048576 * 10) / 10,
        aciklama: g.aciklama, feed: !!g.feed, hata: g.hata, link: g.kalici, medya: g.medya,
        kural: g.kural_anahtar ? { anahtar: g.kural_anahtar, baslik: g.kural_baslik, icerik: g.kural_icerik, takip: !!g.kural_takip, id: g.kural } : null,
      }));
      return metin({ video_depolama: r.video, gonderiler: liste });
    }
    case "video_yukleme_komutu": {
      const yol = String(a.yol ?? "").trim();
      if (!yol) return hata("Dosya yolu gerekli.");
      const ad = yol.split("/").pop() ?? "video.mp4";
      const kok = (env.KOK ?? "").replace(/\/$/, "");
      return metin(`Terminalde çalıştırın (dosya doğrudan sisteme yüklenir, 100 MB'a kadar):\n\n` +
        `curl -sS -X PUT -H "Authorization: Bearer ${atolye.anahtar}" --data-binary @"${yol}" "${kok}/api/disari/video?ad=${encodeURIComponent(ad)}"\n\n` +
        `Çıktıdaki "dosya" değerini gonderi_planla aracına verin.`);
    }
    case "gonderi_planla": {
      const id = await hesapBul(api, a.hesap);
      const zaman = Date.parse(String(a.zaman ?? ""));
      if (!zaman) return hata("zaman ISO 8601 biçiminde olmalı, ör. 2026-11-07T19:00:00+03:00");
      const r = await api("POST", "/api/gonderi", {
        id: a.id, hesap: id, dosya: a.dosya, aciklama: a.aciklama, zaman, feed: a.feed ?? true,
        kural_anahtar: a.kural_anahtar ?? "", kural_baslik: a.kural_baslik ?? "", kural_icerik: a.kural_icerik ?? "", kural_takip: a.kural_takip ?? true,
      });
      return r.hata ? hata(r.hata) : metin(`Gönderi #${r.id} ${a.id ? "güncellendi" : "planlandı"}: ${new Date(zaman).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} (Türkiye saati).`);
    }
    case "gonderi_iptal": {
      const r = await api("DELETE", `/api/gonderi/${Number(a.id)}`);
      return r.hata ? hata(r.hata) : metin(`Gönderi ${a.id} iptal edildi.`);
    }
    case "gonderi_yeniden": {
      const r = await api("POST", `/api/gonderi/${Number(a.id)}/yeniden`);
      return r.hata ? hata(r.hata) : metin(`Gönderi ${a.id} yeniden kuyruğa alındı.`);
    }
    case "hazir_sorular_yaz": return metin(await api("POST", "/api/hazir-sorular", { liste: a.liste ?? [] }));
    case "sablonlar_yaz":
      await api("POST", "/api/sablonlar", a.sablonlar ?? {});
      return metin("Şablonlar güncellendi.");
    case "simdi_tara":
      await api("POST", "/api/simdi");
      return metin("Tarama ve gönderi kuyruğu çalıştırıldı; sonuç için 'durum' aracındaki olaylara bakın.");
    default:
      return hata(`Bilinmeyen araç: ${ad}`);
  }
}

/** JSON-RPC isteğini işler. */
export async function mcp(req: Request, env: Env, atolye: Atolye, api: ApiCagir): Promise<Response> {
  const cevap = (veri: unknown, durum = 200) =>
    new Response(veri === null ? null : JSON.stringify(veri), { status: durum, headers: { "Content-Type": "application/json" } });
  if (req.method === "GET") return new Response("SSE akışı yok; POST kullanın.", { status: 405, headers: { Allow: "POST, DELETE" } });
  if (req.method === "DELETE") return cevap(null, 200);
  if (req.method !== "POST") return cevap({ jsonrpc: "2.0", error: { code: -32600, message: "POST bekleniyor" }, id: null }, 405);
  const govde = await req.json<any>().catch(() => null);
  if (!govde) return cevap({ jsonrpc: "2.0", error: { code: -32700, message: "JSON okunamadı" }, id: null }, 400);
  const istekler = Array.isArray(govde) ? govde : [govde];
  const sonuclar: unknown[] = [];
  for (const m of istekler) {
    if (m.id === undefined || m.id === null) continue; // bildirim
    sonuclar.push({ jsonrpc: "2.0", id: m.id, ...(await yanitla(env, atolye, m, api)) });
  }
  if (!sonuclar.length) return cevap(null, 202);
  return cevap(Array.isArray(govde) ? sonuclar : sonuclar[0]);
}

async function yanitla(env: Env, atolye: Atolye, m: any, api: ApiCagir): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  try {
    switch (m.method) {
      case "initialize":
        return { result: { protocolVersion: SURUM, capabilities: { tools: {} }, serverInfo: { name: "yeklab-dm", version: "2.0.0" } } };
      case "ping": return { result: {} };
      case "tools/list": return { result: { tools: ARACLAR } };
      case "tools/call": {
        const ad = String(m.params?.name ?? "");
        if (!ARACLAR.some((a) => a.name === ad)) return { error: { code: -32602, message: `Araç yok: ${ad}` } };
        try {
          return { result: await aracCagir(env, atolye, api, ad, m.params?.arguments ?? {}) };
        } catch (e) {
          return { result: hata((e as Error).message) };
        }
      }
      default: return { error: { code: -32601, message: `Yöntem yok: ${m.method}` } };
    }
  } catch (e) {
    return { error: { code: -32603, message: (e as Error).message } };
  }
}
