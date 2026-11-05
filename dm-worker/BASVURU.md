# Herkese açmadan önce yapılacaklar (işletme sahibi için)

Yazılım tarafı bitti: çok kullanıcılı panel, Instagram ile giriş, planlı Reels, yorum→DM otomasyonu, MCP, gizlilik/koşul/veri silme
sayfaları ve Meta geri çağrıları hazır ve test edildi. Aşağıdakiler kod dışı adımlardır; sırayla gidin. Her adımın yanında kimin
yapacağı ve ne kadar sürdüğü yazıyor. (Y) = yazılımcı/yönetici, (İ) = işletme sahibi.

## 1. Cloudflare (Y, 20 dk)

- [ ] **R2'yi etkinleştir**: dash.cloudflare.com → R2 → Enable. Cloudflare kart ister (ücretsiz katman 10 GB, ücret kesilmez).
- [ ] `npx wrangler r2 bucket create yeklab-dm-video`
- [ ] `wrangler.toml`'da `[[r2_buckets]]` bloğunun önündeki `#` işaretlerini kaldır, `npm run deploy`. Panelde Gönderiler sayfasındaki
      "Video depolama henüz açık değil" uyarısı kalkar.
- [ ] **Workers Paid** (5 $/ay): Workers & Pages → Plans. Ücretsiz planda günde 100 bin istek ve istek başına 50 alt-istek sınırı var;
      5–10 atölyeyi aşınca gerekir. Ayrıca istek gövdesi sınırı ücretsizde 100 MB (video yükleme), ücretlide 200 MB (Pro) / 500 MB (Business).
- [ ] **Özel alan adı** (isteğe bağlı ama App Review'da iyi görünür): Workers → yeklab-dm → Settings → Domains → ör. `app.yeklab.com.tr`.
      Sonra `wrangler.toml` → `KOK` değerini yeni adrese çevir, deploy et ve aşağıdaki Meta adreslerini de yeni alanla gir.
- [ ] `npx wrangler secret put OTURUM_GIZLI` (uzun rastgele metin; oturum çerezleri yönetici şifresinden ayrışır).

## 2. Meta uygulaması: adresler (Y, 15 dk)

developers.facebook.com → uygulama "claude" (ileride adını değiştirin: Uygulama ayarları → Temel → Görünen ad = ürün adı).

| Alan | Değer |
|---|---|
| Gizlilik politikası URL'si | `https://<KOK>/gizlilik` |
| Hizmet koşulları URL'si | `https://<KOK>/kosullar` |
| Kullanıcı verisi silme (URL) | `https://<KOK>/veri-silme` |
| Uygulama simgesi | 1024×1024 PNG (tasarım gerekir) |
| Kategori | Business and pages / Messaging |
| Instagram → API setup with Instagram login → OAuth redirect URIs | `https://<KOK>/oauth` |
| Aynı sayfa → Deauthorize callback URL | `https://<KOK>/meta/deauthorize` |
| Aynı sayfa → Data deletion request URL | `https://<KOK>/meta/veri-silme` |
| Webhooks → Instagram → Callback URL | `https://<KOK>/webhook`, Verify token = `VERIFY_TOKEN` |
| Webhooks alanları | `messages`, `messaging_postbacks` (Advanced Access sonrası `comments` da eklenir) |

`<KOK>` = `wrangler.toml` → `KOK` (şu an `yeklab-dm.yeklab.workers.dev`).

## 3. Kapalı beta: tester hesaplarla kullanım (Y+İ, hemen)

App Review olmadan uygulama yalnızca **Instagram tester** olarak eklenmiş hesaplarla çalışır. 5–10 kullanıcıyla deneme bu şekilde yapılır:

1. Meta → Uygulama rolleri → Roller → Kişi ekle → **Instagram tester** → kullanıcının Instagram adı.
2. Kullanıcı Instagram'da: Ayarlar → Web sitesi izinleri → Uygulamalar ve web siteleri → Tester davetleri → Kabul.
3. Kullanıcı `https://<KOK>` → "Instagram ile giriş". Atölyesi kendiliğinden açılır; yönetici panelinde görünür.
4. Kullanıcı Instagram'da: Ayarlar → Mesajlar ve hikâye yanıtları → Mesaj denetimleri → Bağlı araçlar → "Mesajlara erişime izin ver" AÇIK.

Bu aşamada `wrangler.toml` → `KAPALI_BETA = "1"` kalır (giriş sayfasında "davetli hesaplar" rozeti).

## 4. Tüzel kişilik ve Business Verification (İ, 1–3 hafta)

Meta, uygulamayı herkese açmak için işletme doğrulaması ister. Gerekenler:

- [ ] Şahıs şirketi ya da şirket: vergi levhası, ticaret sicil/esnaf kaydı, işletme adresi, işletme telefonu, kurumsal e-posta
      (`iletisim@yeklab.com.tr` gibi; `ILETISIM` değişkeniyle aynı olsun).
- [ ] **Meta Business Suite** → business.facebook.com → İşletme ayarları → Güvenlik merkezi → **Doğrulamayı başlat**. Belgeleri yükle
      (vergi levhası + adresli fatura ya da banka belgesi). Genellikle 2–10 iş günü.
- [ ] Uygulamayı bu işletme hesabına bağla: Uygulama ayarları → Temel → **Doğrulanmış işletme** alanı.
- [ ] Uygulama ayarları → Temel → **Veri koruma görevlisi / iletişim e-postası** doldurulsun.

## 5. App Review: Advanced Access (İ+Y, 1–2 hafta)

Uygulama → **Uygulama inceleme → İzinler ve özellikler**. Şu dört izin için "Advanced Access iste":

| İzin | Ne için | Ekran kaydında gösterilecek |
|---|---|---|
| `instagram_business_basic` | hesap adı, paylaşımlar listesi | Giriş → panelde Paylaşımlar sayfası |
| `instagram_business_manage_messages` | DM gönderme, webhook | Yorum → DM'in gittiği an; Mesajlar sayfası |
| `instagram_business_manage_comments` | yorum okuma, yoruma yanıt | Otomasyon açma, yoruma "DM'den gönderdim" yanıtı |
| `instagram_business_content_publish` | planlı Reels | Yeni gönderi → video yükle → yayınlandığı an |

Her izin için istenenler:
- **Kullanım senaryosu metni** (İngilizce, 2–3 cümle): "Content creators schedule Reels and automatically send a link via DM to people
  who comment a keyword. The app only reads comments on the user's own posts and messages people who initiated contact."
- **Ekran kaydı** (1–3 dk, İngilizce altyazı ya da anlatım): giriş → hesap bağlama → otomasyon oluşturma → gerçek bir yorum → DM'in gelişi →
  gönderi planlama → yayın. Kayıt için hesabın tester olması yeterli; gerçek yorum için ikinci bir telefon kullanın.
- **Test kullanıcısı**: inceleme ekibinin kullanabileceği bir Instagram tester hesabı ve panel giriş adımları (Instagram ile giriş).
- **Gizlilik, koşullar, veri silme adresleri** (yukarıda hazır).

Onay gelince:
- [ ] Webhooks → Instagram → `comments` alanına da abone ol (yorumlar anında gelir; dakikalık tarama yedek kalır).
- [ ] `wrangler.toml` → `KAPALI_BETA = "0"`, deploy. Tester eklemeye gerek kalmaz; herkes "Instagram ile giriş" yapabilir.

## 6. Hukuki metinler (İ, avukat önerilir)

- `/gizlilik` ve `/kosullar` sayfaları hazır; şirket unvanı, adresi, MERSİS/vergi no ve KVKK aydınlatma metni eklenecek
  (`src/hukuk.ts`). Şu an "hizmet davetli kullanıcılara ücretsiz" yazıyor; ücretli plan açılınca güncellenir.
- Ücret alınacaksa: ödeme altyapısı (iyzico/Stripe), e-fatura, mesafeli satış sözleşmesi. Sistemde `plan` alanı var (ücretsiz/pro);
  ödeme entegrasyonu yazılmadı, yönetici panelden elle değiştirir.

## 7. İşletim (Y, sürekli)

- Telegram bildirimleri yöneticiye gelir: token kopması, gönderi hatası, webhook imzası, 15 dakikada 5+ gönderim hatası.
- Yönetim paneli (`/` → Yönetici): atölyeler, plan, durdurma, atölyeye girme, sistem olayları.
- Yedek: D1 → `npx wrangler d1 export yeklab-dm --remote --output=yedek.sql` (haftada bir).
- Sınırlar: Instagram hesap başına günde 50 gönderi, saatte ~200 API çağrısı; mesaj penceresi 24 saat (kişi yazmadan DM gitmez).
