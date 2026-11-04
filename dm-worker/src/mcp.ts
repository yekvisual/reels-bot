// Claude ve diğer MCP istemcileri için uzak sunucu (Streamable HTTP, durumsuz).
// Araçlar panelin iç API'sine (/api/...) bağlanır; kimlik doğrulama OTOMASYON_ANAHTARI ile.
//   Authorization: Bearer <anahtar>   ya da   POST /mcp/<anahtar>  (başlık koyamayan istemciler için)

type ApiCagir = (yontem: "GET" | "POST" | "DELETE", yol: string, govde?: unknown) => Promise<any>;

const SURUM = "2025-06-18";
const metin = (t: unknown) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 1) }] });
const hata = (t: string) => ({ content: [{ type: "text", text: t }], isError: true });

const ARACLAR = [
  {
    name: "durum",
    description: "Sistemin genel durumu: bağlı Instagram hesapları, aktif uyarılar, son webhook zamanı, şablonlar, hazır sorular ve son kayıt satırları.",
    inputSchema: { type: "object", properties: { kayit: { type: "integer", description: "Kaç kayıt satırı dönsün (varsayılan 20, en çok 60)" } } },
  },
  {
    name: "paylasimlar",
    description: "Bir hesabın son 30 paylaşımı; her birinin yorum sayısı, bağlı DM kuralı, son 30 günün teslim/özel yanıt sayıları ve link tıklamaları.",
    inputSchema: { type: "object", properties: { hesap: { type: "string", description: "Kullanıcı adı (ör. yekvisual) ya da hesap kimliği" } }, required: ["hesap"] },
  },
  {
    name: "kurallar",
    description: "DM kurallarını listeler (paylaşım, 'aciklama:' ile paylaşım öncesi bağlananlar ve 'hikaye:' kuralları).",
    inputSchema: { type: "object", properties: { hesap: { type: "string", description: "Boş bırakılırsa tüm hesaplar" } } },
  },
  {
    name: "kural_kaydet",
    description: "Yeni DM kuralı ekler ya da id verilirse günceller. medya: paylaşım kimliği, 'aciklama:<açıklamada geçen metin>' (henüz paylaşılmamış video için) ya da 'hikaye:*' / 'hikaye:<id>'. Yorumda anahtar kelime geçince kişiye içerik DM ile gönderilir.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Güncellenecek kural (boşsa yeni)" },
        hesap: { type: "string", description: "Kullanıcı adı ya da hesap kimliği" },
        medya: { type: "string" },
        anahtar: { type: "string", description: "Virgülle ayrılmış kelimeler, ör. 'flux, link'" },
        baslik: { type: "string", description: "Mesajlarda geçen kısa ad, ör. 'FLUX 3 Klein'" },
        icerik: { type: "string", description: "Gönderilecek metin ve linkler" },
        takip_sart: { type: "boolean", description: "Takip etmeyene önce takip istesin (varsayılan true)" },
        yorum_yaniti: { type: "boolean", description: "Yoruma herkese açık 'DM'den gönderdim' yazsın (varsayılan true)" },
        aktif: { type: "boolean", description: "Varsayılan true" },
      },
      required: ["hesap", "medya", "baslik"],
    },
  },
  {
    name: "kural_sil",
    description: "Bir DM kuralını istatistikleriyle birlikte siler.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  },
  {
    name: "ozet",
    description: "Hesabın son 30 günü gün gün: özel yanıt, takip isteği, teslim sayıları.",
    inputSchema: { type: "object", properties: { hesap: { type: "string" } }, required: ["hesap"] },
  },
  {
    name: "kisiler",
    description: "Link isteyen / mesaj yazan kişiler: kullanıcı adı, takip durumu, ilk-son etkileşim, kaç teslim aldığı. Arama ve kural filtresi var.",
    inputSchema: {
      type: "object",
      properties: { hesap: { type: "string" }, q: { type: "string", description: "Kullanıcı adı ya da ad araması" }, kural: { type: "integer", description: "Yalnızca bu kuraldan teslim alanlar" } },
      required: ["hesap"],
    },
  },
  {
    name: "hikayeler",
    description: "Hesabın şu an yayında olan hikâyeleri (hikaye:<id> kuralı yazmak için).",
    inputSchema: { type: "object", properties: { hesap: { type: "string" } }, required: ["hesap"] },
  },
  {
    name: "hazir_sorular_yaz",
    description: "DM açılışında görünen hazır soruları (en çok 4) tüm hesaplara yazar. tur 'son' = en yeni paylaşımın linkini gönderir, 'metin' = cevap metnini gönderir. Boş liste soruları kaldırır.",
    inputSchema: {
      type: "object",
      properties: {
        liste: {
          type: "array",
          items: { type: "object", properties: { soru: { type: "string" }, tur: { type: "string", enum: ["son", "metin"] }, cevap: { type: "string" } }, required: ["soru", "tur"] },
        },
      },
      required: ["liste"],
    },
  },
  {
    name: "sablonlar_yaz",
    description: "Mesaj şablonlarını günceller (takip isteği, teslim metni, hikâye teşekkürü vb.). Önce 'durum' ile mevcut anahtarları gör; yalnızca verilen alanlar değişir.",
    inputSchema: { type: "object", properties: { sablonlar: { type: "object", additionalProperties: { type: "string" } } }, required: ["sablonlar"] },
  },
  {
    name: "simdi_tara",
    description: "Dakikalık yorum taramasını beklemeden hemen çalıştırır.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function hesapBul(api: ApiCagir, verilen: string): Promise<string> {
  const v = String(verilen ?? "").trim().replace(/^@/, "");
  const { hesaplar } = await api("GET", "/api/durum");
  const h = hesaplar.find((x: any) => x.id === v || x.kullanici.toLowerCase() === v.toLowerCase());
  if (!h) throw new Error(`Hesap bulunamadı: ${verilen}. Bağlı hesaplar: ${hesaplar.map((x: any) => "@" + x.kullanici).join(", ")}`);
  return h.id;
}

async function aracCagir(api: ApiCagir, ad: string, a: any) {
  switch (ad) {
    case "durum": {
      const d = await api("GET", "/api/durum");
      const n = Math.min(Math.max(Number(a.kayit ?? 20), 0), 60);
      return metin({
        hesaplar: d.hesaplar, uyarilar: d.uyarilar, son_webhook: d.son_webhook ? new Date(d.son_webhook).toISOString() : null,
        deneme_modu: d.deneme, bildirim: d.bildirim, link_kok: d.link_kok, sablonlar: d.sablonlar, hazir_sorular: d.hazir_sorular,
        kayit: d.kayit.slice(0, n).map((k: any) => ({ zaman: new Date(k.zaman).toISOString(), hesap: k.hesap, metin: k.metin })),
      });
    }
    case "paylasimlar": {
      const id = await hesapBul(api, a.hesap);
      const p = await api("GET", `/api/hesap/${id}/paylasimlar`);
      const sayi = (kural: number, tur: string) => p.sayilar.find((s: any) => s.kural === kural && s.tur === tur)?.adet ?? 0;
      const liste = p.medya.map((m: any) => {
        const kural = p.kurallar.find((k: any) => k.medya === m.id);
        return {
          id: m.id, zaman: m.timestamp, tur: m.media_type, yorum: m.comments_count, link: m.permalink,
          aciklama: (m.caption ?? "").slice(0, 120),
          kural: kural ? {
            id: kural.id, anahtar: kural.anahtar, baslik: kural.baslik, aktif: !!kural.aktif,
            ozel_yanit: sayi(kural.id, "ozel_yanit"), takip_istegi: sayi(kural.id, "takip"), teslim: sayi(kural.id, "teslim"),
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
    case "kural_sil":
      await api("DELETE", `/api/kural/${Number(a.id)}`);
      return metin(`Kural ${a.id} silindi.`);
    case "ozet": {
      const id = await hesapBul(api, a.hesap);
      return metin(await api("GET", `/api/hesap/${id}/ozet`));
    }
    case "kisiler": {
      const id = await hesapBul(api, a.hesap);
      const qs = new URLSearchParams();
      if (a.q) qs.set("q", String(a.q));
      if (a.kural) qs.set("kural", String(a.kural));
      const r = await api("GET", `/api/hesap/${id}/kisiler?${qs}`);
      return metin({
        toplam: r.toplam,
        kisiler: r.kisiler.map((k: any) => ({
          kullanici: k.kullanici, ad: k.ad, takipci: !!k.takipci, kaynak: k.kaynak, teslim: k.teslim, linkler: k.basliklar,
          ilk: new Date(k.ilk).toISOString(), son: new Date(k.son).toISOString(),
        })),
      });
    }
    case "hikayeler": {
      const id = await hesapBul(api, a.hesap);
      return metin(await api("GET", `/api/hesap/${id}/hikayeler`));
    }
    case "hazir_sorular_yaz":
      return metin(await api("POST", "/api/hazir-sorular", { liste: a.liste ?? [] }));
    case "sablonlar_yaz":
      await api("POST", "/api/sablonlar", a.sablonlar ?? {});
      return metin("Şablonlar güncellendi.");
    case "simdi_tara":
      await api("POST", "/api/simdi");
      return metin("Tarama çalıştırıldı; sonuç için 'durum' aracındaki kayıtlara bak.");
    default:
      return hata(`Bilinmeyen araç: ${ad}`);
  }
}

/** JSON-RPC isteğini işler. İstemci yetkisi çağıran tarafta doğrulanmış olmalı. */
export async function mcp(req: Request, api: ApiCagir): Promise<Response> {
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
    if (m.id === undefined || m.id === null) continue; // bildirim (notifications/initialized vb.)
    const r = await yanitla(m, api);
    sonuclar.push({ jsonrpc: "2.0", id: m.id, ...r });
  }
  if (!sonuclar.length) return cevap(null, 202);
  return cevap(Array.isArray(govde) ? sonuclar : sonuclar[0]);
}

async function yanitla(m: any, api: ApiCagir): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  try {
    switch (m.method) {
      case "initialize":
        return { result: { protocolVersion: SURUM, capabilities: { tools: {} }, serverInfo: { name: "yeklab-dm", version: "1.0.0" } } };
      case "ping":
        return { result: {} };
      case "tools/list":
        return { result: { tools: ARACLAR } };
      case "tools/call": {
        const ad = String(m.params?.name ?? "");
        if (!ARACLAR.some((a) => a.name === ad)) return { error: { code: -32602, message: `Araç yok: ${ad}` } };
        try {
          return { result: await aracCagir(api, ad, m.params?.arguments ?? {}) };
        } catch (e) {
          return { result: hata((e as Error).message) };
        }
      }
      default:
        return { error: { code: -32601, message: `Yöntem yok: ${m.method}` } };
    }
  } catch (e) {
    return { error: { code: -32603, message: (e as Error).message } };
  }
}
