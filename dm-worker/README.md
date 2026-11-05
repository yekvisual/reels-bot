# YEK Lab DM (Cloudflare Worker)

Instagram için **planlı Reels paylaşımı** + **yorum→DM link otomasyonu**, çok kullanıcılı. Her kullanıcı Instagram ile giriş yapar,
kendi "atölyesinde" hesaplarını bağlar, videolarını planlar, kurallarını yazar. Cloudflare'in ücretsiz katmanında çalışır;
ürünleştirme adımları (R2, Meta App Review, tüzel kişilik) **BASVURU.md**'de.

- **Yorumlar** her dakika taranır (sırayla 12 hesap). Meta yorum webhook'u için App Review ister; onay gelince `comments` alanına abone olunur.
- **DM ve buton tıklamaları** webhook ile anında işlenir. Son 6 saatte webhook gelmediyse DM'ler de dakikada bir yoklanır.
- **Planlı gönderiler**: video R2'de bekler; zamanı gelince Worker konteyner açar, Instagram işleyince yayınlar, yorum→DM kuralını kendiliğinden açar, videoyu siler.
- **Panel** (`/`): Genel bakış, Gönderiler, Otomasyonlar, Paylaşımlar, Kişiler, Mesajlar (şablonlar + hazır sorular), Olaylar, Ayarlar (hesaplar, API/MCP anahtarı).
- **Yönetici** (`/` → alt köşede "Yönetici", şifre `PANEL_SIFRE`): tüm atölyeler, plan, durdurma, atölyeye girip kullanıcı gibi görme, sistem olayları.
- **Gizlilik**: yorum/mesaj metni tutulmaz; kişi kayıtları 12 ay, olaylar 90 gün. DM'ye "verilerimi sil" yazan silinir. Meta'nın
  yetki kaldırma ve veri silme geri çağrıları (`/meta/deauthorize`, `/meta/veri-silme`) hesabı ve verisini siler, onay kodu üretir.

Akış: yorum → özel yanıt ("takip edip butona basın") → butona basınca takip kontrolü → takip ediyorsa linkler,
etmiyorsa "Takip ettim" butonlu hatırlatma. DM'ye doğrudan anahtar kelime yazanlar da aynı akıştan geçer.

## Kurulum (bir kez)

```bash
cd dm-worker
npm install
npx wrangler login
npx wrangler d1 create yeklab-dm                # çıkan database_id → wrangler.toml
npm run db:uzak                                 # tablolar (schema.sql)
npx wrangler secret put PANEL_SIFRE             # yönetici şifresi
npx wrangler secret put OTURUM_GIZLI            # oturum imzası (rastgele uzun metin)
npx wrangler secret put VERIFY_TOKEN            # rastgele; Meta webhook ayarına da aynısı
npx wrangler secret put APP_SECRET              # Meta → Instagram → API setup with Instagram login → Instagram app secret
npm run deploy
```

`wrangler.toml` → `[vars]`: `KOK` (Worker adresi), `URUN_ADI`, `ILETISIM`, `KAPALI_BETA`, `INSTAGRAM_APP_ID`, `LINK_KOK`, `SITE_KOK`.
Meta panelindeki adresler (OAuth redirect, webhook, deauthorize, data deletion) için BASVURU.md §2.

**Mevcut (tek kullanıcılı) veritabanından geçiş**: `npx wrangler d1 execute yeklab-dm --remote --file=gecis/002-cok-kullanici.sql`
bir kez çalıştırılır; hesaplar, kurallar ve şablonlar 1 numaralı atölyeye ("YEK Lab", plan pro) bağlanır.

**Video depolama (R2)**: Cloudflare panelinde R2 etkinleştirilip `npx wrangler r2 bucket create yeklab-dm-video` çalıştırıldıktan sonra
`wrangler.toml`'daki `[[r2_buckets]]` satırlarının `#` işareti kaldırılır. Bağlı değilken panel "video depolama kapalı" der, gerisi çalışır.

## Kullanıcı tarafı

1. `https://<KOK>` → **Instagram ile giriş** (işletme/içerik üreticisi hesabı). Atölye kendiliğinden açılır.
   App Review öncesi hesap Meta'da **Instagram tester** olmalı (BASVURU.md §3).
2. Instagram'da Ayarlar → Mesajlar ve hikâye yanıtları → Mesaj denetimleri → Bağlı araçlar → "Mesajlara erişime izin ver" açık olmalı.
3. Otomasyonlar → paylaşım seç → kelime, başlık, içerik. Ya da Gönderiler → Yeni gönderi → video + açıklama + saat + kural.
4. Ayarlar → "Claude ve API bağlantısı": atölye anahtarı, Claude Code komutu, claude.ai bağlayıcı adresi, curl ile video yükleme.

Başka hesap bağlamak: Ayarlar → Hesap bağla (aynı atölyeye eklenir). Bir Instagram hesabı yalnızca bir atölyede olabilir.

## Claude ile yönetme (MCP)

`/mcp` ucu durumsuz Streamable HTTP MCP sunucusudur. Kimlik: `Authorization: Bearer <atölye anahtarı>` ya da `/mcp/<anahtar>`.
Araçlar: `durum`, `paylasimlar`, `kurallar`, `kural_kaydet`, `kural_sil`, `ozet`, `kisiler`, `hikayeler`, `gonderiler`,
`video_yukleme_komutu`, `gonderi_planla`, `gonderi_iptal`, `gonderi_yeniden`, `hazir_sorular_yaz`, `sablonlar_yaz`, `simdi_tara`.

```sh
claude mcp add --transport http yeklab-dm https://<KOK>/mcp --header "Authorization: Bearer <anahtar>"
```

Video yükleme MCP üzerinden değil, `PUT /api/disari/video?ad=…` ile (Claude komutu verir); dönen `dosya` değeri `gonderi_planla`'ya girilir.

## Dış API (publish.py ve betikler)

- `POST /api/disari/kural` `{hesap?, medya, aciklama, anahtar, baslik, icerik, takip_sart}` — paylaşım sonrası kural. Eski
  `OTOMASYON_ANAHTARI` 1 numaralı atölyeye eşlenir; `publish.py` değişmeden çalışır.
- `PUT /api/disari/video?ad=video.mp4` (gövde: dosya, en çok 100 MB) → `{dosya, ad, boyut}`.

## Bildirim ve sağlık

Yöneticiye Telegram (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT`): bağlantı yenilenemedi/50 gündür yenilenmedi, gönderi yayınlanamadı,
15 dakikada 5+ gönderim hatası, webhook imzası tutmuyor, kelime var ama içerik yok. Aynı tür 6 saatte bir; kullanıcının panelinde
24 saat şerit olarak görünür (kapatılabilir). `HEALTHCHECK_URL` verilirse her dakikalık işin sonunda ping gider.

## Yerel geliştirme ve test

```bash
printf 'APP_SECRET=x\nVERIFY_TOKEN=y\nPANEL_SIFRE=z\n' > .dev.vars
npx wrangler d1 execute yeklab-dm --local -c wrangler.yerel.toml --file=schema.sql
npx wrangler dev -c wrangler.yerel.toml --test-scheduled      # http://127.0.0.1:8787, cron: /__scheduled?cron=*+*+*+*+*
npm run kontrol                                               # tsc
```

`wrangler.yerel.toml`: R2 bağlı, `DENEME=1` (Instagram'a gitmez), `KOK` yerel. Instagram girişi yerelde çalışmaz; hesaplar
`wrangler d1 execute --local` ile elle eklenir, oturum çerezi `PANEL_SIFRE` ile imzalanır (bkz. test betiği geçmişi).

## Davranış notları

- Yorumlar en yeniden eskiye gelir; 7 günden eski yorumlara özel yanıt gönderilemez, tarama orada durur.
- DM'de anahtar kelime yalnızca birebir ve en çok 3 kelimelik mesajlarda tanınır; esnek eşleşme (ek, harf hatası) yorumlarda.
- Gönderilemeyen özel yanıt 3 denemeden sonra (ya da Meta kalıcı hata verirse hemen) bırakılır.
- Planlı gönderi 3 kez denenir; Instagram 45 dakikada işlemezse yeniden konteyner açılır. İzin hatasında (kod 10/190/200) hemen durur,
  kullanıcıya "hesabı yeniden bağlayın" uyarısı çıkar; hesap `instagram_business_content_publish` izniyle yeniden bağlanınca "Yeniden dene".
- Anahtar yapıştırılarak eklenmiş eski hesaplarda izin listesi boştur; paylaşım denenir, Meta reddederse aynı uyarı çıkar.
- Webhook alınamayan dönemde DM yoklaması, kişinin son mesajından 24 saat içinde olmak kaydıyla çalışır.
- Teslim edilen linkler `LINK_KOK/<kod>` kısa linkine çevrilir; site 404 sayfası Worker'daki `/l/<kod>?json=1`'e sorar. Önizleme botları sayılmaz.
