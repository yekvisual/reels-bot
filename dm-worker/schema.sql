-- YEK Lab DM: D1 şeması (sıfırdan kurulum). Mevcut veritabanı için: gecis/*.sql
-- Çok kullanıcılı: her "atölye" (çalışma alanı) kendi Instagram hesaplarını, kurallarını, gönderilerini ve ayarlarını görür.

-- Atölyeler: Instagram ile ilk girişte kendiliğinden açılır. anahtar = API/MCP anahtarı (panelde görünür, yenilenebilir)
CREATE TABLE IF NOT EXISTS atolyeler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad TEXT NOT NULL,
  anahtar TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'ucretsiz',  -- ucretsiz | pro (ödeme altyapısı yok; yönetici elle değiştirir)
  aktif INTEGER NOT NULL DEFAULT 1,       -- 0: yönetici durdurdu (giriş yapılabilir, bot çalışmaz)
  notlar TEXT NOT NULL DEFAULT '',
  olusturma INTEGER NOT NULL,
  son_giris INTEGER NOT NULL DEFAULT 0
);

-- Instagram hesapları (Instagram Login, uzun ömürlü anahtar)
CREATE TABLE IF NOT EXISTS hesaplar (
  id TEXT PRIMARY KEY,              -- Instagram hesap kimliği (user_id)
  atolye INTEGER NOT NULL DEFAULT 1,
  kullanici TEXT NOT NULL,
  token TEXT NOT NULL,
  token_yenilendi INTEGER NOT NULL, -- ms
  aktif INTEGER NOT NULL DEFAULT 1,
  izinler TEXT NOT NULL DEFAULT '', -- OAuth'ta verilen izinler (virgüllü); paylaşım izni yoksa panel "yeniden bağla" der
  son_tarama INTEGER NOT NULL DEFAULT 0, -- yorum taraması sırası (en eski önce)
  eklenme INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS hesaplar_atolye ON hesaplar (atolye);

-- Kurallar: paylaşıma yorum yazan ya da DM atan kişiye gidecek içerik
CREATE TABLE IF NOT EXISTS kurallar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hesap TEXT NOT NULL,
  medya TEXT NOT NULL,              -- paylaşım kimliği | aciklama:<metin> | hikaye:* | hikaye:<id>
  anahtar TEXT NOT NULL,            -- virgülle ayrılmış kelimeler
  baslik TEXT NOT NULL,             -- mesajlarda geçer ("FLUX 3 Klein için linkler")
  icerik TEXT NOT NULL,             -- teslim edilen metin ve linkler
  takip_sart INTEGER NOT NULL DEFAULT 1,
  yorum_yaniti INTEGER NOT NULL DEFAULT 1, -- yoruma herkese açık "DM'den gönderdim"
  aktif INTEGER NOT NULL DEFAULT 1,
  olusturma INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kurallar_hesap ON kurallar (hesap, aktif);

-- Planlı gönderiler: video R2'de bekler, zamanı gelince Worker paylaşır, sonra kuralı açar
CREATE TABLE IF NOT EXISTS gonderiler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  atolye INTEGER NOT NULL,
  hesap TEXT NOT NULL,
  dosya TEXT NOT NULL,              -- R2 anahtarı (tahmin edilemez)
  ad TEXT NOT NULL,                 -- yüklenen dosyanın adı
  boyut INTEGER NOT NULL,
  aciklama TEXT NOT NULL,
  zaman INTEGER NOT NULL,           -- planlanan yayın zamanı (ms)
  feed INTEGER NOT NULL DEFAULT 1,  -- akışta da görünsün
  durum TEXT NOT NULL DEFAULT 'bekliyor', -- bekliyor | isleniyor | yayinda | hata | iptal
  konteyner TEXT,                   -- Instagram medya konteyneri
  medya TEXT,                       -- yayınlanan paylaşımın kimliği
  kalici TEXT,                      -- paylaşım adresi (permalink)
  hata TEXT,
  deneme INTEGER NOT NULL DEFAULT 0,
  adim_zamani INTEGER NOT NULL DEFAULT 0, -- son durum değişimi (takılmayı anlamak için)
  kural_anahtar TEXT NOT NULL DEFAULT '',
  kural_baslik TEXT NOT NULL DEFAULT '',
  kural_icerik TEXT NOT NULL DEFAULT '',
  kural_takip INTEGER NOT NULL DEFAULT 1,
  kural INTEGER,                    -- yayın sonrası açılan kuralın kimliği
  olusturma INTEGER NOT NULL,
  yayin INTEGER
);
CREATE INDEX IF NOT EXISTS gonderiler_durum ON gonderiler (durum, zaman);
CREATE INDEX IF NOT EXISTS gonderiler_atolye ON gonderiler (atolye, zaman);

-- Paylaşımın son görülen yorum sayısı: değişmediyse yorumlar yeniden çekilmez
CREATE TABLE IF NOT EXISTS medya_sayac (medya TEXT PRIMARY KEY, yorum INTEGER NOT NULL);

-- İşlenen yorum ve mesajlar (aynı olaya iki kez yanıt gitmesin)
CREATE TABLE IF NOT EXISTS islenen (ozet TEXT PRIMARY KEY, zaman INTEGER NOT NULL);

-- Özel yanıt ya da takip isteği gitmiş, teslim bekleyen kişiler
CREATE TABLE IF NOT EXISTS bekleyen (
  hesap TEXT NOT NULL,
  kisi TEXT NOT NULL,               -- özet
  kural INTEGER NOT NULL,
  zaman INTEGER NOT NULL,
  PRIMARY KEY (hesap, kisi, kural)
);

-- Günlük sayaçlar: yorum, ozel_yanit, takip_istendi, teslim, tiklama
CREATE TABLE IF NOT EXISTS istatistik (
  kural INTEGER NOT NULL,
  gun TEXT NOT NULL,
  tur TEXT NOT NULL,
  adet INTEGER NOT NULL,
  PRIMARY KEY (kural, gun, tur)
);

-- Olay günlüğü: atolye 0 = sistem (yalnız yönetici görür)
CREATE TABLE IF NOT EXISTS kayit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zaman INTEGER NOT NULL,
  atolye INTEGER NOT NULL DEFAULT 0,
  hesap TEXT,
  metin TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kayit_atolye ON kayit (atolye, id);

-- Ayarlar: atolye 0 = sistem (son_webhook, uyari:*, bildirim_son:*), diğerleri atölyenin şablonları
CREATE TABLE IF NOT EXISTS ayarlar (atolye INTEGER NOT NULL, ad TEXT NOT NULL, deger TEXT NOT NULL, PRIMARY KEY (atolye, ad));

-- Gönderilemeyen olayların deneme sayısı: 3 denemeden sonra vazgeçilir
CREATE TABLE IF NOT EXISTS deneme (ozet TEXT PRIMARY KEY, adet INTEGER NOT NULL, zaman INTEGER NOT NULL);

-- Girişte yanlış şifre denemeleri (IP özeti): 15 dakikada 5'ten sonra beklenir
CREATE TABLE IF NOT EXISTS giris_deneme (ip TEXT PRIMARY KEY, adet INTEGER NOT NULL, zaman INTEGER NOT NULL);

-- Teslim edilen linkler: kısa kod → gerçek adres (tıklama sayacı)
CREATE TABLE IF NOT EXISTS linkler (kod TEXT PRIMARY KEY, kural INTEGER NOT NULL, url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS link_tiklama (kod TEXT NOT NULL, gun TEXT NOT NULL, adet INTEGER NOT NULL, PRIMARY KEY (kod, gun));

-- Kişiler: linki isteyen ya da mesaj yazan hesaplar (gizlilik sayfasında açıklanır; 12 ay sonra silinir)
CREATE TABLE IF NOT EXISTS kisiler (
  hesap TEXT NOT NULL,
  igsid TEXT NOT NULL,                -- Instagram'ın bu uygulamaya özel kişi kimliği
  kullanici TEXT,
  ad TEXT,
  ilk INTEGER NOT NULL,
  son INTEGER NOT NULL,
  takipci INTEGER,                    -- son bilinen takip durumu (1/0), bilinmiyorsa NULL
  kaynak TEXT,                        -- yorum | dm | hikaye
  PRIMARY KEY (hesap, igsid)
);
CREATE TABLE IF NOT EXISTS teslimler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hesap TEXT NOT NULL,
  igsid TEXT NOT NULL,
  kural INTEGER NOT NULL,
  zaman INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS teslimler_kisi ON teslimler (hesap, igsid);
