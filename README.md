# Reels Bot — Instagram'a otomatik Reels paylaşımı

`videos/` klasörüne koyduğunuz videoları **resmi Instagram API'si** ile sırayla
Reels olarak paylaşır. GitHub Actions üzerinde zamanlanmış çalışır (bilgisayarınız
kapalıyken bile) veya bilgisayarınızdan tek komutla çalıştırılır.

Şifre istemez, bot gibi giriş yapmaz; hesabınızın kapatılma riski yoktur.

## Nasıl çalışır

```
videos/001_tanitim.mp4      ← video
videos/001_tanitim.txt      ← açıklama + hashtag'ler (isteğe bağlı)
videos/002_kamera.mp4
...
```

1. Her gün belirlenen saatte GitHub Actions çalışır.
2. `posted.json`'da olmayan, **alfabetik sıradaki ilk** videoyu seçer.
3. Instagram'a Reels olarak yükler, işlenmesini bekler, paylaşır.
4. Paylaşılan videoyu `posted.json`'a yazar; ertesi gün sıradakine geçer.

Videoları `001_`, `002_` gibi numaralandırırsanız sırayı siz belirlersiniz.

## Gereksinimler

- Instagram hesabı **Profesyonel** olmalı (İçerik Üreticisi veya İşletme).
  Instagram → Ayarlar → Hesap türü ve araçlar → Profesyonel hesaba geç.
- Video: MP4/MOV, 3 sn – 15 dk, en fazla 300 MB, dikey 9:16 önerilir.
- GitHub'da kullanılacaksa her video **100 MB altında** olmalı (Git LFS kullanmayın).

## 1. Adım — Meta uygulaması ve token (bir kez, ~10 dk)

1. <https://developers.facebook.com/apps> → **Uygulama oluştur**.
2. Kullanım durumu olarak **"Instagram'dan mesajları ve içerikleri yönet"**
   (Manage messaging & content on Instagram) seçin.
3. Uygulama panelinde **Instagram → API setup with Instagram login** bölümüne gidin.
4. **"Generate access tokens"** altında **Add account** ile kendi Instagram
   hesabınızı ekleyin ve izinleri onaylayın
   (`instagram_business_basic`, `instagram_business_content_publish`).
5. Hesabın yanındaki **Generate token** ile token'ı alın. Bu uzun ömürlü
   (60 gün) token'dır — kimseyle paylaşmayın.

> Uygulama "Geliştirme" modunda kalabilir; kendi hesabınıza paylaşım için
> App Review gerekmez.

## 2. Adım — GitHub'a kurulum

1. GitHub'da yeni bir repo açın ve bu klasörün içeriğini yükleyin.
2. Repo → **Settings → Secrets and variables → Actions**:
   - **Secrets** sekmesi → `IG_ACCESS_TOKEN` = 1. adımdaki token
3. Repo → **Actions** sekmesi → workflow'ları etkinleştirin.
4. **Reels paylaş → Run workflow** ile ilk paylaşımı elle test edin.

### Videoları Instagram'a nasıl ulaştırıyoruz? (önemli)

Instagram Login API'si videoyu **herkese açık bir adresten kendisi indirir**.

- **Kolay yol — public repo:** Repo herkese açıksa bot adresi otomatik kurar
  (`raw.githubusercontent.com/...`). Ek ayar gerekmez.
  Dezavantaj: henüz paylaşılmamış videolarınız repoda görülebilir.
- **Gizli repo istiyorsanız:** Videoları herkese açık bir depolamaya koyun
  (Cloudflare R2, AWS S3, kendi siteniz…) ve Variables sekmesine
  `VIDEO_BASE_URL` = `https://depolama-adresiniz/` ekleyin. Dosya yolu
  `videos/ad.mp4` olarak sonuna eklenir.
- **Alternatif — Facebook Login:** Instagram hesabınız bir Facebook sayfasına
  bağlıysa video doğrudan dosyadan yüklenebilir (herkese açık adres gerekmez).
  Variables: `IG_API=facebook`, Secrets: `IG_USER_ID` ve Facebook Login ile
  alınmış token.

### Paylaşım saatini değiştirme

`.github/workflows/post-reel.yml` içindeki `cron` satırı (saat **UTC**'dir,
Türkiye = UTC+3):

| Ne zaman | cron |
|---|---|
| Her gün 19:00 | `0 16 * * *` |
| Her gün 12:00 ve 20:00 | `0 9,17 * * *` |
| Pzt-Çar-Cuma 18:00 | `0 15 * * 1,3,5` |

GitHub zamanlanmış işleri birkaç dakika gecikmeli başlatabilir.

### Token'ın otomatik yenilenmesi (önerilir)

Token 60 günde sona erer. `refresh-token.yml` ayda iki kez yeniler:

1. GitHub → Settings → Developer settings → **Fine-grained tokens** →
   yalnızca bu repo, izin: **Secrets: Read and write**.
2. Bu token'ı repoya `GH_PAT` secret'ı olarak ekleyin.

Kurmazsanız 60 günde bir 1. adımdaki gibi yeni token alıp secret'ı güncelleyin.

### Bu Mac'ten kurulum (GH_PAT gerekmez)

- `./token-ayarla.sh` — Meta panelinden kopyaladığınız token'ı panodan okur, @yekvisual'a ait olduğunu
  doğrular, `IG_ACCESS_TOKEN` secret'ına ve Anahtar Zinciri'ne yazar, panoyu temizler, eşitleme işini
  açıp bir kez çalıştırır. Token ekrana basılmaz.
- `./token-yenile.sh` — Anahtar Zinciri'ndeki token'ı yeniler ve secret'ı günceller (60 gün dolmadan,
  ör. ayda bir elle ya da launchd ile haftalık).

## Yorumlara DM ile yanıt

`dm.py` (`.github/workflows/dm-yanit.yml`, 10 dakikada bir) yorumlara anahtar kelimeyi
(açıklamadaki "yorumlara X yaz") yazanlara özel yanıt gönderir: takip edip mesaja yazmalarını
ister. Yazdıklarında takip ediyorlarsa `dm/kurallar.json`'daki kaynakları, etmiyorlarsa
hatırlatma gönderir. DM'ye doğrudan kelimeyi yazanlar da aynı akıştan geçer; başka mesajlara
dokunmaz.

- Token'da ayrıca `instagram_business_manage_comments` ve `instagram_business_manage_messages`
  izinleri olmalı (Meta paneli → izinleri ekle → Generate token → `./token-ayarla.sh`).
- Instagram sınırları: yoruma tek özel yanıt, yorumdan sonra 7 gün içinde; DM'ye kişinin son
  mesajından sonra 24 saat içinde. Daha eskiler uygulamadan elle yanıtlanır.
- Yeni paylaşım için `dm/kurallar.json`'a `video` (ya da eski paylaşım için `kod`), `baslik`,
  `icerik` ekleyin.
- `python dm.py --deneme` gönderilecekleri gösterir; `python dm.py --incele` paylaşımları ve
  konuşmaları `dm/inceleme/rapor.json`'a yazar (depoya girmez).
- Depo herkese açık olduğu için `dm/durum.json`'da yalnızca yorum kimliklerinin özetleri durur.

## Bilgisayardan kullanım

```bash
cd reels-bot
pip install -r requirements.txt
cp .env.example .env      # IG_ACCESS_TOKEN ve VIDEO_BASE_URL'i doldurun
python publish.py --check     # hesap ve kota kontrolü
python publish.py --dry-run   # sıradaki video, paylaşmadan
python publish.py             # sıradakini paylaş
python publish.py --file videos/002_kamera.mp4
```

Mac'te belirli saatte otomatik çalıştırmak için `crontab -e` ile:

```
0 19 * * * cd /tam/yol/reels-bot && /usr/bin/python3 publish.py >> bot.log 2>&1
```

## Sınırlar ve sorun giderme

- Hesap başına 24 saatte en fazla ~50–100 API paylaşımı (`--check` güncel kotayı gösterir).
- **`Video format is not supported`** → videoyu H.264 + AAC MP4 olarak yeniden dışa aktarın.
- **Durum `ERROR`** → çoğunlukla video adresi açılamıyor (repo gizli / LFS) ya da format sorunu.
- **Token hatası (code 190)** → token süresi dolmuş; yenisini alın.
- Videoyu sıradan çıkarmak için silin; tekrar paylaşmak için `posted.json`'dan kaydını silin.
