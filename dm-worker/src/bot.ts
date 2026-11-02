// Yorum → özel yanıt → (takip kontrolü) → teslim akışı. Bir Bot, bir hesap içindir.

import {
  Env, Hesap, Kural, ayarYaz, birak, denemeSay, hazirSorular, kaydet, kisiKaydet, kisiSil, kisiTakip, kisiVar,
  linkleriKisalt, ozet, sahiplen, say, teslimKaydet, trGun,
} from "./db";
import { anahtarlar, eslesir, eslesirKesin, norm } from "./eslesme";
import { IG, zaman } from "./ig";

const YORUM_PENCERE = 7 * 864e5;  // özel yanıt yorumdan sonra en geç 7 gün içinde
const MESAJ_PENCERE = 23 * 36e5;  // normal DM, kişinin son mesajından sonra 24 saat içinde
const WEBHOOK_GUVEN = 6 * 36e5;   // son 6 saatte webhook geldiyse DM'ler yoklanmaz
export const BAGSIZ = "aciklama:"; // henüz paylaşılmamış paylaşımın kuralı: "aciklama:<açıklamada geçen metin>"
export const HIKAYE = "hikaye:";   // hikâye yanıtı kuralı: "hikaye:*" (hepsi) ya da "hikaye:<story_id>"
const EN_COK_DENEME = 3;
// Yeniden denemenin işe yaramayacağı Meta hataları: 10 = izin yok / pencere kapalı, 551 = kişi ulaşılamaz
const KALICI_HATA = /\(kod (10|551)[)/]/;

type Mesaj = { text: string } | { attachment: object };
export interface MesajEk { hikaye?: string; etiket?: boolean }

function butonlu(metin: string, baslik: string, payload: string): Mesaj {
  return {
    attachment: {
      type: "template",
      payload: { template_type: "button", text: metin.slice(0, 640), buttons: [{ type: "postback", title: baslik, payload }] },
    },
  };
}

/** Teslim mesajını geçmişte tanımak için iz: içerikteki ilk link, yoksa ilk 40 karakter. */
function teslimIzi(kural: Kural): string {
  return kural.icerik.match(/https?:\/\/\S+/)?.[0] ?? kural.icerik.trim().slice(0, 40);
}

export const paylasimKurali = (k: Kural) => !k.medya.startsWith(BAGSIZ) && !k.medya.startsWith(HIKAYE);

export class Bot {
  ig: IG;
  deneme: boolean;
  sonHata = "";

  constructor(private env: Env, private hesap: Hesap, private ayar: Record<string, string>) {
    this.ig = new IG(hesap.token);
    this.deneme = env.DENEME === "1";
  }

  private sablon(ad: string, kural: Kural, icerik = kural.icerik): string {
    return this.ayar[ad]
      .replaceAll("{baslik}", kural.baslik)
      .replaceAll("{icerik}", icerik)
      .replaceAll("{kullanici}", this.hesap.kullanici);
  }

  /** Teslim metni: linkler sayaçlı kısa kodlarla ({LINK_KOK}/<kod>) değiştirilir. */
  private async teslimMetni(kural: Kural): Promise<string> {
    return this.sablon("teslim", kural, await linkleriKisalt(this.env, kural.id, kural.icerik)).slice(0, 1000);
  }

  private kaydet(metin: string) {
    return kaydet(this.env, this.hesap.id, (this.deneme ? "[deneme] " : "") + metin);
  }

  private async gonder(alici: object, mesaj: Mesaj, etiket: string): Promise<boolean> {
    if (this.deneme) {
      await this.kaydet(`${etiket}: ${"text" in mesaj ? mesaj.text : JSON.stringify(mesaj)}`.slice(0, 300));
      return true;
    }
    try {
      await this.ig.post(`${this.hesap.id}/messages`, { recipient: alici, message: mesaj });
      await this.kaydet(etiket);
      return true;
    } catch (e) {
      this.sonHata = (e as Error).message;
      await this.kaydet(`${etiket} gönderilemedi: ${this.sonHata}`);
      return false;
    }
  }

  /** Gönderilemeyen olay: kalıcı hataysa ya da 3 kez denendiyse işlenmiş sayılır, yoksa bırakılır. */
  private async vazgecOrBirak(oz: string, etiket: string): Promise<boolean> {
    const adet = await denemeSay(this.env, oz);
    if (KALICI_HATA.test(this.sonHata) || adet >= EN_COK_DENEME) {
      await this.kaydet(`${etiket}: ${adet}. denemeden sonra vazgeçildi`);
      return true;
    }
    await birak(this.env, oz);
    return false;
  }

  private async kurallar(): Promise<Kural[]> {
    const { results } = await this.env.DB.prepare(
      "SELECT * FROM kurallar WHERE hesap = ? AND aktif = 1 ORDER BY olusturma DESC",
    ).bind(this.hesap.id).all<Kural>();
    return results;
  }

  private async kisiOzet(kisi: string) {
    return ozet("k", this.hesap.id, kisi);
  }

  private async bekleyenEkle(kisi: string, kural: number) {
    await this.env.DB.prepare("INSERT OR REPLACE INTO bekleyen (hesap, kisi, kural, zaman) VALUES (?, ?, ?, ?)")
      .bind(this.hesap.id, await this.kisiOzet(kisi), kural, Date.now()).run();
  }

  /** Kişiyi listeye yazar; DM'den gelen yeni kişinin kullanıcı adı Instagram'dan bir kez okunur. */
  private async kisiYaz(kisi: string, kaynak: string, kullanici?: string | null) {
    try {
      if (!kullanici && !(await kisiVar(this.env, this.hesap.id, kisi))) {
        const p = await this.ig.get(kisi, { fields: "username,name" });
        await kisiKaydet(this.env, this.hesap.id, kisi, kaynak, p.username ?? null, p.name ?? null);
        return;
      }
      await kisiKaydet(this.env, this.hesap.id, kisi, kaynak, kullanici ?? null);
    } catch (e) {
      await kisiKaydet(this.env, this.hesap.id, kisi, kaynak, kullanici ?? null).catch(() => {});
      await this.kaydet(`kişi bilgisi alınamadı: ${(e as Error).message}`);
    }
  }

  // --- 1. Yorumlar (cron) -------------------------------------------------------------
  async yorumlar() {
    const kurallar = await this.kurallar();
    if (!kurallar.length) return;
    const medya = await this.ig.get(`${this.hesap.id}/media`, { fields: "id,caption,comments_count", limit: "50" });
    for (const m of medya.data ?? []) {
      let kural = kurallar.find((k) => k.medya === m.id);
      if (!kural) {
        // Paylaşılmadan önce açıklamadaki bir metinle tanımlanmış kural: ilk eşleşen (en yeni) paylaşıma bağlanır
        kural = kurallar.find((k) => k.medya.startsWith(BAGSIZ) && (m.caption ?? "").includes(k.medya.slice(BAGSIZ.length)));
        if (kural) {
          kural.medya = m.id;
          await this.env.DB.prepare("UPDATE kurallar SET medya = ? WHERE id = ?").bind(m.id, kural.id).run();
          await this.kaydet(`kural paylaşıma bağlandı (${kural.baslik})`);
        }
      }
      if (!kural) continue;
      const eski = await this.env.DB.prepare("SELECT yorum FROM medya_sayac WHERE medya = ?").bind(m.id).first<number>("yorum");
      if (eski === m.comments_count) continue;
      let tamam = true;
      // Yorumlar en yeniden eskiye gelir; 7 günden eskiye gelince sayfalama durur
      const yorumlar = await this.ig.tumu(`${m.id}/comments`, { fields: "id,text,timestamp,from", limit: "50" }, 300,
        (y) => Date.now() - zaman(y.timestamp) > YORUM_PENCERE);
      for (const y of yorumlar) {
        if (y.from?.id === this.hesap.id || y.from?.username === this.hesap.kullanici) continue;
        if (Date.now() - zaman(y.timestamp) > YORUM_PENCERE) continue;
        if (!eslesir(y.text ?? "", anahtarlar(kural.anahtar))) continue;
        const oz = await ozet("y", y.id);
        if (!(await sahiplen(this.env, oz))) continue;
        await say(this.env, kural.id, "yorum");
        if (await this.ozelYanit(y, kural)) {
          if (kural.yorum_yaniti) await this.herkeseAcik(y.id);
        } else if (!(await this.vazgecOrBirak(oz, `özel yanıt (${kural.baslik})`))) {
          tamam = false;
        }
      }
      // Gönderilemeyen olursa sayaç güncellenmez, bir sonraki dakika yeniden denenir.
      // Sayı var ama liste boşsa da (Meta yorumları henüz göstermiyor) güncellenmez.
      if (tamam && (yorumlar.length || !m.comments_count)) {
        await this.env.DB.prepare("INSERT OR REPLACE INTO medya_sayac (medya, yorum) VALUES (?, ?)").bind(m.id, m.comments_count).run();
      }
    }
  }

  private async ozelYanit(y: any, kural: Kural): Promise<boolean> {
    const alici = { comment_id: y.id };
    if (y.from?.id) await kisiKaydet(this.env, this.hesap.id, y.from.id, "yorum", y.from.username ?? null);
    if (!kural.takip_sart) {
      const ok = await this.gonder(alici, { text: await this.teslimMetni(kural) }, `özel yanıt + teslim (${kural.baslik})`);
      if (ok) {
        await say(this.env, kural.id, "teslim");
        if (y.from?.id) await teslimKaydet(this.env, this.hesap.id, y.from.id, kural.id);
      }
      return ok;
    }
    let ok = false;
    if (this.ayar.ozel_yanit_buton === "1") {
      ok = await this.gonder(alici, butonlu(this.sablon("ilk_buton", kural), this.ayar.buton_link, `teslim:${kural.id}`),
        `özel yanıt, butonlu (${kural.baslik})`);
      if (!ok && !this.deneme) {
        // Buton reddedildiyse bir daha denenmez, metinli sürüme geçilir
        await ayarYaz(this.env, "ozel_yanit_buton", "0");
        this.ayar.ozel_yanit_buton = "0";
      }
    }
    if (!ok) ok = await this.gonder(alici, { text: this.sablon("ilk_metin", kural) }, `özel yanıt (${kural.baslik})`);
    if (ok) {
      await say(this.env, kural.id, "ozel_yanit");
      if (y.from?.id) await this.bekleyenEkle(y.from.id, kural.id);
    }
    return ok;
  }

  private async herkeseAcik(yorum: string) {
    const secenek = this.ayar.yorum_yanitlari.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!secenek.length) return;
    const metin = secenek[Math.floor(Math.random() * secenek.length)];
    if (this.deneme) return void (await this.kaydet(`yorum yanıtı: ${metin}`));
    try {
      await this.ig.post(`${yorum}/replies`, { message: metin });
    } catch (e) {
      await this.kaydet(`yorum yanıtı gönderilemedi: ${(e as Error).message}`);
    }
  }

  // --- 2. Mesajlar (webhook ya da yoklama) -------------------------------------------
  async mesaj(kisi: string, mid: string, metin: string | null, payload: string | null, ek: MesajEk = {}) {
    if (kisi === this.hesap.id) return;
    // Yalnız görsel/çıkartma gönderenler link istemiyor; spam'de API sınırı da harcanmasın
    if (!metin?.trim() && !payload && !ek.hikaye && !ek.etiket) return;
    const oz = await ozet("m", mid);
    if (!(await sahiplen(this.env, oz))) return;

    if (metin && norm(metin).includes("verilerimi sil")) {
      await kisiSil(this.env, this.hesap.id, kisi, await this.kisiOzet(kisi));
      await this.gonder({ id: kisi }, { text: this.ayar.veri_silindi }, "veriler silindi");
      return;
    }

    if (ek.etiket) return this.hikayeEtiketi(kisi);

    const kurallar = await this.kurallar();
    let kural: Kural | undefined;

    // Hazır soru (ice breaker) tıklaması
    const ice = payload?.match(/^ice:(\d+)$/);
    if (ice) {
      const soru = hazirSorular(this.ayar)[Number(ice[1])];
      if (!soru) return;
      await this.kisiYaz(kisi, "dm");
      if (soru.tur === "son") {
        kural = kurallar.find(paylasimKurali);
        if (!kural) return void (await this.kaydet("hazır soru: teslim edilecek kural yok"));
        return this.teslimEt(kisi, kural);
      }
      await this.gonder({ id: kisi }, { text: soru.cevap.slice(0, 1000) }, `hazır soru yanıtı (${soru.soru.slice(0, 30)})`);
      return;
    }

    // Hikâyeye yanıt: önce o hikâyenin kuralı, yoksa "tüm hikâyeler" kuralı; kelime boşsa her yanıt sayılır
    if (ek.hikaye) {
      kural = kurallar.find((k) => k.medya === HIKAYE + ek.hikaye) ?? kurallar.find((k) => k.medya === HIKAYE + "*");
      if (kural && kural.anahtar && !(metin && eslesir(metin, anahtarlar(kural.anahtar)))) kural = undefined;
      if (kural) {
        await this.kisiYaz(kisi, "hikaye");
        await say(this.env, kural.id, "yorum");
        return this.teslimEt(kisi, kural);
      }
    }

    const p = payload?.match(/^(teslim|kontrol):(\d+)$/);
    if (p) kural = kurallar.find((k) => k.id === Number(p[2]));
    if (!kural) {
      const kisiOz = await this.kisiOzet(kisi);
      const b = await this.env.DB.prepare("SELECT kural FROM bekleyen WHERE hesap = ? AND kisi = ? ORDER BY zaman DESC LIMIT 1")
        .bind(this.hesap.id, kisiOz).first<number>("kural");
      kural = kurallar.find((k) => k.id === b);
    }
    // Aynı kelime birden çok paylaşımda olabilir; DM'ye yalnızca kelime yazan en yeni paylaşımı kastediyordur
    if (!kural && metin) kural = kurallar.find((k) => paylasimKurali(k) && eslesirKesin(metin, anahtarlar(k.anahtar)));
    // Sohbet cümleleri ("teşekkürler", "çok güzel olmuş") için Instagram'a gidilmez; yalnız "tamam" gibi kısa yanıtlar
    if (!kural && (payload || (metin && norm(metin).split(" ").length <= 3))) kural = await this.gecmistenKural(kisi, kurallar);
    if (!kural) return;
    await this.kisiYaz(kisi, "dm");
    await this.teslimEt(kisi, kural);
  }

  /** Hikâyede anılma: kişi başına günde bir teşekkür (şablon boşsa kapalı). */
  private async hikayeEtiketi(kisi: string) {
    const metin = this.ayar.hikaye_tesekkur.trim();
    if (!metin) return;
    if (!(await sahiplen(this.env, await ozet("e", this.hesap.id, kisi, trGun(Date.now()))))) return;
    await this.kisiYaz(kisi, "hikaye");
    await this.gonder({ id: kisi }, { text: metin.slice(0, 1000) }, "hikâye etiketi teşekkürü");
  }

  /** Bekleyen kaydı yoksa (yorumdaki kimlik DM'dekinden farklıysa ya da kayıt silindiyse)
   *  konuşma geçmişindeki son takip isteğinden kuralı bulur, dm.py'deki gibi. Mesajlar en yeniden eskiye
   *  gelir: takip isteğinden sonra teslim mesajı gitmişse linkler zaten verilmiştir, yeniden gönderilmez. */
  private async gecmistenKural(kisi: string, kurallar: Kural[]): Promise<Kural | undefined> {
    try {
      const k = await this.ig.get(`${this.hesap.id}/conversations`, {
        platform: "instagram", user_id: kisi, fields: "messages.limit(10){from,message}",
      });
      const bizim = (k.data?.[0]?.messages?.data ?? []).filter((x: any) => x.from?.id === this.hesap.id);
      for (const x of bizim) {
        const m: string = x.message ?? "";
        const kural = kurallar.find((r) => m.includes(r.baslik));
        if (!kural) continue;
        if (m.includes(teslimIzi(kural)) || m.includes("için linkler:")) return undefined; // en son teslim gitmiş
        if (m.includes("takip")) return kural;
      }
    } catch (e) {
      await this.kaydet(`konuşma geçmişi okunamadı: ${(e as Error).message}`);
    }
  }

  private async teslimEt(kisi: string, kural: Kural) {
    if (kural.takip_sart) {
      let takipci: boolean;
      try {
        takipci = Boolean((await this.ig.get(kisi, { fields: "is_user_follow_business" })).is_user_follow_business);
      } catch (e) {
        return void (await this.kaydet(`takip bilgisi alınamadı: ${(e as Error).message}`));
      }
      await kisiTakip(this.env, this.hesap.id, kisi, takipci);
      if (!takipci) {
        const kisiOz = await this.kisiOzet(kisi);
        const soruldu = await this.env.DB.prepare("SELECT 1 AS v FROM bekleyen WHERE hesap = ? AND kisi = ? AND kural = ?")
          .bind(this.hesap.id, kisiOz, kural.id).first("v");
        const ad = soruldu ? "takip_yok" : "takip_iste";
        if (await this.gonder({ id: kisi }, butonlu(this.sablon(ad, kural), this.ayar.buton_takip, `kontrol:${kural.id}`),
          soruldu ? `takip hatırlatma (${kural.baslik})` : `takip isteği (${kural.baslik})`)) {
          await this.bekleyenEkle(kisi, kural.id);
          await say(this.env, kural.id, "takip_istendi");
        }
        return;
      }
    }
    if (await this.gonder({ id: kisi }, { text: await this.teslimMetni(kural) }, `teslim (${kural.baslik})`)) {
      await this.env.DB.prepare("DELETE FROM bekleyen WHERE hesap = ? AND kisi = ? AND kural = ?")
        .bind(this.hesap.id, await this.kisiOzet(kisi), kural.id).run();
      await say(this.env, kural.id, "teslim");
      await teslimKaydet(this.env, this.hesap.id, kisi, kural.id);
    }
  }

  /** Webhook gelmiyorsa son konuşmaları yoklar (dm.py'deki yöntem). */
  async dmYokla(sonWebhook: number) {
    if (Date.now() - sonWebhook < WEBHOOK_GUVEN) return;
    const konusmalar = await this.ig.get(`${this.hesap.id}/conversations`, {
      platform: "instagram", fields: "id,updated_time", limit: "10",
    });
    for (const c of konusmalar.data ?? []) {
      if (Date.now() - zaman(c.updated_time) > 15 * 6e4) break;
      const msjlar = (await this.ig.get(c.id, { fields: "messages.limit(5){id,created_time,from,message}" })).messages?.data ?? [];
      const son = msjlar[0]; // en yenisi başta
      if (!son || son.from?.id === this.hesap.id || son.from?.username === this.hesap.kullanici) continue;
      if (Date.now() - zaman(son.created_time) > MESAJ_PENCERE) continue;
      await this.mesaj(son.from.id, son.id, son.message ?? null, null);
    }
  }

  /** Hazır soruları (ice breakers) Instagram profiline yazar; liste boşsa siler. */
  async hazirSorulariYaz(liste: { soru: string }[]) {
    if (!liste.length) {
      await this.ig.sil(`${this.hesap.id}/messenger_profile`, { platform: "instagram", fields: ["ice_breakers"] });
      return;
    }
    await this.ig.post(`${this.hesap.id}/messenger_profile`, {
      platform: "instagram",
      ice_breakers: [{ locale: "default", call_to_actions: liste.map((s, i) => ({ question: s.soru.slice(0, 80), payload: `ice:${i}` })) }],
    });
  }
}
