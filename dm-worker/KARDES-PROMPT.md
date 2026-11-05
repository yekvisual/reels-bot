# Kardeşin için Claude promptu

Aşağıdaki metni olduğu gibi kopyalayıp Claude Code'a (ya da claude.ai'ye) yapıştır. Öncesinde elinde olması gerekenler:

- Bir **Cloudflare** hesabı (ücretsiz, cloudflare.com)
- Bir **Meta geliştirici** hesabı (developers.facebook.com; Facebook hesabınla girilir)
- Kendi **Instagram hesabın** (profesyonel: işletme ya da içerik üreticisi olmalı)
- Bilgisayarda **Node.js** ve **git** (yoksa Claude kurdurur)

---

```
Instagram için "yorum → DM" otomasyonu ve planlı Reels paylaşımı yapan, çok kullanıcılı bir Cloudflare Worker'ı
kendi hesaplarımda sıfırdan kuracağız. Kod hazır ve test edilmiş; sen kurulumu adım adım yönet, her adımda ne
yapacağımı söyle, çıktıları doğrula, hata olursa düzelt. Ben teknik değilim; komutları sen çalıştır, benden
yalnızca panellerde (Cloudflare, Meta) tıklamam gereken şeyleri iste ve tam olarak nereye tıklayacağımı yaz.

KAYNAK: https://github.com/yekvisual/reels-bot (herkese açık). Yalnızca `dm-worker/` klasörü ilgilendiriyor.
Önce `dm-worker/README.md` ve `dm-worker/BASVURU.md` dosyalarını oku; kurulum ve Meta adresleri orada.

ÖNEMLİ KURALLAR
- Bu kurulum TAMAMEN BENİM hesaplarımda olacak. Kodun orijinal sahibinin (yekvisual) Worker'ına, veritabanına,
  Meta uygulamasına dokunma; wrangler.toml içindeki hazır database_id, KOK, INSTAGRAM_APP_ID gibi değerler ONA ait,
  hepsini benimkilerle değiştireceksin.
- `gecis/` klasöründeki geçiş betiğini ÇALIŞTIRMA; o eski veritabanı içindi. Biz `schema.sql` ile sıfırdan kuruyoruz.
- Kodu değiştirmene gerek yok; sadece yapılandırma (wrangler.toml, secrets) ve dış ayarlar.
- Deploy, secret yazma gibi dışarıyı etkileyen her komuttan önce bana ne yapacağını bir cümleyle söyle.

ÖNCE BANA SOR
1. Ürün adı (panelde ve giriş sayfasında görünecek)
2. Destek e-postası (gizlilik ve koşullar sayfalarında görünecek)
3. Worker adı (küçük harf, tire; adres `https://<ad>.<hesap>.workers.dev` olacak)
4. Yönetici şifresi (ben belirleyeceğim, sen üretme)

SONRA SIRAYLA
A. Hazırlık: git ve Node var mı bak, yoksa kur. Repoyu klonla, `dm-worker` içinde `npm install`.
B. Cloudflare: `npx wrangler login` (tarayıcı açılır, ben onaylarım). `npx wrangler d1 create <workerAdı>` ile
   veritabanı aç; dönen database_id'yi ve database_name'i wrangler.toml'a yaz. `name` alanını da worker adıyla değiştir.
   `[[r2_buckets]]` satırları yorumda kalsın (R2'yi sonra açacağız).
   Tabloları kur: `npx wrangler d1 execute <workerAdı> --remote --file=schema.sql`
C. wrangler.toml [vars]: URUN_ADI ve ILETISIM benim verdiklerim; KAPALI_BETA "1" kalsın; KOK = Worker adresim
   (ilk deploy'dan sonra kesinleşir, `npx wrangler deploy` çıktısındaki adres); LINK_KOK = KOK + "/l";
   SITE_KOK satırını sil; INSTAGRAM_APP_ID'yi Meta adımında dolduracağız.
D. Secrets (`npx wrangler secret put ...`): PANEL_SIFRE (benim şifrem), OTURUM_GIZLI (sen rastgele 40+ karakter üret),
   VERIFY_TOKEN (rastgele; Meta webhook'a da aynısı girilecek, bana göster). APP_SECRET'i Meta adımından sonra yaz.
E. İlk deploy: `npm run deploy`. Çıkan adresi KOK'a yaz, bir daha deploy et. Tarayıcıda adresi aç: giriş sayfası
   görünmeli; alt köşeden "Yönetici" ile şifremle girebilmeliyim.
F. Meta uygulaması (developers.facebook.com, bana adım adım yazdır):
   1. Uygulamalarım → Uygulama oluştur → kullanım durumu "Other" → tür "Business" → ad = ürün adı.
   2. Ürün ekle → Instagram → "API setup with Instagram login".
   3. Oradaki "Instagram app ID" ve "Instagram app secret"ı al: ID'yi wrangler.toml'daki INSTAGRAM_APP_ID'ye yaz,
      secret'ı `npx wrangler secret put APP_SECRET` ile kaydet (Meta "App ID" değil, Instagram ürününün ID'si).
   4. Aynı sayfada Business login settings: OAuth redirect URI = https://<KOK>/oauth,
      Deauthorize callback = https://<KOK>/meta/deauthorize, Data deletion request = https://<KOK>/meta/veri-silme.
   5. Webhooks: Callback URL = https://<KOK>/webhook, Verify token = VERIFY_TOKEN; alanlar: messages, messaging_postbacks.
   6. Uygulama ayarları → Temel: Gizlilik politikası = https://<KOK>/gizlilik, Hizmet koşulları = https://<KOK>/kosullar,
      Kullanıcı verisi silme = https://<KOK>/veri-silme. Kategori: Business and pages.
   7. Uygulama rolleri → Roller → Kişi ekle → Instagram tester → benim Instagram adım. Ben Instagram'da
      Ayarlar → Web sitesi izinleri → Uygulamalar ve web siteleri → Tester davetleri'nden kabul edeceğim.
   Sonra `npm run deploy`.
G. Deneme: Panelde "Instagram ile giriş" ile hesabımı bağlayayım. Instagram'da Ayarlar → Mesajlar ve hikâye yanıtları →
   Mesaj denetimleri → Bağlı araçlar → "Mesajlara erişime izin ver" açık olsun. Bir paylaşımıma kural yazalım,
   kendi yorumumla deneyelim: özel yanıt + DM gelmeli. Panelde Olaylar'da görünmeli.
H. Claude bağlantısı: Panel → Ayarlar → "Claude ve API bağlantısı"ndaki komutla bu Claude'u Worker'ıma bağla
   (`claude mcp add ...`); `durum` aracını çağırıp hesabımı gördüğünü doğrula.
I. İsteğe bağlı: Telegram bildirimi (TELEGRAM_TOKEN, TELEGRAM_CHAT) ve R2 (Cloudflare panelinde R2'yi aç,
   `npx wrangler r2 bucket create <workerAdı>-video`, wrangler.toml'daki r2 satırlarını aç, deploy). R2 olmadan planlı
   gönderi dışında her şey çalışır.

En sonda bana şunları tek liste hâlinde ver: Worker adresim, yönetici girişi, Meta uygulama adı ve ID'si,
hangi secret'ların yazıldığı, ve BASVURU.md'deki 4–6. bölümlerin (tüzel kişilik, Business Verification, App Review,
hukuki metinler) ne zaman gerekeceği. O bölümleri şimdi YAPMA, sadece özetle.
```
