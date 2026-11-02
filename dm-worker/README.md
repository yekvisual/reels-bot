# YEK Lab DM (Cloudflare Worker)

Yorumlara anahtar kelime yazanlara DM ile link gönderir: `dm.py`'nin sunucusuz, çok hesaplı ve panelli hali.
Mac açık olmak zorunda değil; Cloudflare'in ücretsiz katmanında çalışır.

- **Yorumlar** her dakika kontrol edilir. Meta, yorum webhook'u için App Review istiyor; dakikalık kontrolle gerek kalmıyor.
- **DM ve buton tıklamaları** webhook ile anında işlenir. Son 6 saatte webhook gelmediyse DM'ler de dakikada bir yoklanır.
- **Panel** (`/`): paylaşımları gösterir; paylaşıma dokunup anahtar kelime, başlık ve linkleri girersiniz. Henüz
  paylaşılmamış bir video için kural, açıklamasının ilk satırıyla önceden eklenir; paylaşılınca kendiliğinden bağlanır.
- Kişisel veri tutulmaz: yorum, mesaj ve kişi kimlikleri yalnızca özet (hash) olarak durur, 30 günde silinir.
  DM'ye "verilerimi sil" yazanın bekleyen kayıtları silinir ve kendisine bilgi verilir.
- DM'de anahtar kelime yalnızca birebir ve en çok 3 kelimelik mesajlarda tanınır; esnek eşleşme (ek, harf hatası) yorumlarda.
- Gönderilemeyen özel yanıt 3 denemeden sonra (ya da Meta kalıcı hata verirse hemen) bırakılır; panel girişinde 15 dakikada 5 yanlış şifreden sonra beklenir.

Akış: yorum → özel yanıt ("takip edip butona basın") → butona basınca takip kontrolü → takip ediyorsa linkler,
etmiyorsa "Takip ettim" butonlu hatırlatma. DM'ye doğrudan anahtar kelime yazanlar da aynı akıştan geçer.

## Kurulum (bir kez)

```bash
cd dm-worker
npm install
npx wrangler login                    # Cloudflare hesabı (ücretsiz) tarayıcıda açılır
npx wrangler d1 create yeklab-dm      # çıkan database_id → wrangler.toml
npm run db:uzak                       # tablolar
python3 aktar.py > /tmp/kurallar.sql && npx wrangler d1 execute yeklab-dm --remote --file=/tmp/kurallar.sql

npx wrangler secret put PANEL_SIFRE   # panel şifresi
npx wrangler secret put VERIFY_TOKEN  # rastgele bir metin; Meta paneline de aynısı yazılır
npx wrangler secret put APP_SECRET    # Meta → uygulama → Instagram → API setup with Instagram login → Instagram app secret
npm run deploy                        # adres: https://yeklab-dm.<alt-alan>.workers.dev
```

Sonra:

1. Hesap bağlama, iki yol:
   - **Instagram ile bağla** (kolay): Panel → Hesaplar → Hesap ekle → "Instagram ile bağla". Instagram hangi hesapla gireceğinizi sorar,
     onaylayınca anahtar kendiliğinden alınır ve webhook aboneliği açılır. Bir kez hazırlık: Meta paneli → Instagram → API setup with
     Instagram login → **Business login settings** → OAuth redirect URIs'e `https://yeklab-dm.yeklab.workers.dev/oauth` ekleyin ve
     aynı sayfadaki **Instagram app ID**'yi `wrangler.toml` → `INSTAGRAM_APP_ID`'ye yazıp `npm run deploy`.
   - **Anahtar yapıştır**: Meta panelinde hesabın yanındaki **Generate token** ile alınan anahtar aynı pencereye yapıştırılır.

   Her iki yolda da bağlanacak hesap Meta panelinde **Instagram tester** olmalı (App roles → Roles → Add people → Instagram tester) ve
   daveti Instagram'da kabul etmeli (Ayarlar → Web sitesi izinleri → Uygulamalar ve web siteleri → Tester davetleri). Uygulama Advanced
   Access almadığı sürece Meta bunu şart koşuyor. Anahtarlar her pazartesi kendiliğinden yenilenir.
2. Meta panelinde **Webhooks**: Callback URL `https://…workers.dev/webhook`, Verify token = `VERIFY_TOKEN`;
   `messages` ve `messaging_postbacks` alanlarına abone olun.
3. Meta webhook'ları yalnızca Live moddaki uygulamaya gönderir. Gizlilik politikası adresi olarak
   `https://…workers.dev/gizlilik` yazıp uygulamayı Live'a alın. Webhook gelmezse sistem yine çalışır, DM'ler dakikada bir yoklanır.

## Paylaşımda kural kendiliğinden kurulsun (publish.py)

`./anahtar-kur.sh` bir kez çalıştırılır: Worker'a `OTOMASYON_ANAHTARI`, GitHub'a `DM_WORKER_ANAHTAR`, Mac Keychain'e `reels-bot-dm` yazar.
Sonra `publish.py` her paylaşımdan sonra `/api/disari/kural`'a gider: `dm/kurallar.json`'da kayıt varsa linkler aktif kural olur,
açıklamada "yorumlara X yaz" var ama kayıt yoksa kural pasif açılır ve bildirim gider. Aynı paylaşım tekrar gönderilse ikinci kural açılmaz.

## Hata bildirimi (Telegram)

1. Telegram'da **@BotFather** → `/newbot` → verdiği anahtarı `npx wrangler secret put TELEGRAM_TOKEN` ile yazın.
2. Bota bir mesaj atın, sonra `https://api.telegram.org/bot<ANAHTAR>/getUpdates` adresindeki `chat.id` değerini
   `npx wrangler secret put TELEGRAM_CHAT` ile yazın.
3. Panel → Mesaj şablonları → "Deneme bildirimi gönder".

Bildirilenler: token yenilenemedi ya da 50 gündür yenilenmedi, 15 dakikada 5+ gönderim hatası, webhook imzası tutmuyor,
paylaşımda kelime var ama link yok. Aynı tür 6 saatte bir; panelin üstünde 24 saat kırmızı şerit.
Worker'ın tamamen durmasını kendisi bildiremez: healthchecks.io'da ücretsiz bir kontrol açıp adresini `HEALTHCHECK_URL` secret'ına yazarsanız
her dakikalık işin sonunda ping gider, kesilince onlar haber verir.

## Link tıklama sayacı

Teslim edilen linkler `yeklab.com.tr/l/<kod>` olarak gider (`LINK_KOK`). Site GitHub Pages'te olduğu için yönlendirme 404 sayfasındaki
küçük bir betikle yapılır: sayfa Worker'daki `/l/<kod>?json=1`'e sorar ve gerçek adrese geçer. Instagram'ın önizleme botları sayılmaz;
aynı kişi aynı gün aynı linki bir kez sayılır (IP saklanmaz, özeti tutulur). Panelde otomasyon başına ve link başına tıklama görünür.

## Hazır sorular, hikâye, kişiler

- **Hazır sorular** (ice breakers): Mesaj şablonları → en çok 4 soru; "Son paylaşımın linkleri" en yeni aktif kuralı teslim eder.
- **Hikâye**: Yeni otomasyon → "Hikâye yanıtları için". Tüm hikâyeler ya da belirli bir hikâye; kelime boşsa her yanıt sayılır.
  Hikâyede etiketleyene günde bir teşekkür (şablon boşsa kapalı).
- **Kişiler**: linki isteyen ya da DM yazan herkes kullanıcı adıyla listelenir (12 ay), CSV indirilebilir. Gizlilik sayfası buna göre
  güncellendi; "verilerimi sil" yazan silinir. Meta 24 saat kuralı yüzünden listeden toplu mesaj gönderilemez.

## Eski sistemden geçiş

`wrangler.toml`'da `DENEME = "1"` ile yayınlayın: hiçbir şey göndermez, yapacaklarını panelde "Son olaylar"a yazar.
Doğru göründüğünde eski sistemi kapatıp aynı anda gönderimi açın (ikisi birlikte çalışırsa aynı kişiye iki mesaj gider):

```bash
launchctl bootout gui/$(id -u)/com.yekvisual.reels-bot-dm && rm ~/Library/LaunchAgents/com.yekvisual.reels-bot-dm.plist
gh workflow disable dm-yanit.yml -R yekvisual/reels-bot
# wrangler.toml: DENEME = "0"
npm run deploy
```

Eski sistemde "tamam yaz" mesajını almış, yarım kalmış konuşmalar da tanınır: Worker konuşma geçmişindeki son takip isteğine bakar.

## Yerel deneme

```bash
printf 'PANEL_SIFRE=yerel\nAPP_SECRET=yerel\nVERIFY_TOKEN=yerel\nDENEME=1\n' > .dev.vars
npm run db:yerel && npm run dev       # http://localhost:8787, dakikalık iş: curl "localhost:8787/__scheduled?cron=*+*+*+*+*"
```
