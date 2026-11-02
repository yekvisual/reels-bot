-- Yorum ve mesaj içeriği tutulmaz. Kişi kayıtları (kisiler, teslimler) 12 ay; diğer kimlikler yalnızca özet (hash) olarak durur.

CREATE TABLE IF NOT EXISTS hesaplar (
  id TEXT PRIMARY KEY,              -- Instagram hesap kimliği (user_id)
  kullanici TEXT NOT NULL,
  token TEXT NOT NULL,
  token_yenilendi INTEGER NOT NULL, -- ms
  aktif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS kurallar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hesap TEXT NOT NULL,
  medya TEXT NOT NULL,              -- paylaşım kimliği
  anahtar TEXT NOT NULL,            -- virgülle ayrılmış kelimeler
  baslik TEXT NOT NULL,             -- mesajlarda geçer ("FLUX 3 Klein için linkler")
  icerik TEXT NOT NULL,             -- teslim edilen metin ve linkler
  takip_sart INTEGER NOT NULL DEFAULT 1,
  yorum_yaniti INTEGER NOT NULL DEFAULT 1, -- yoruma herkese açık "DM'den gönderdim"
  aktif INTEGER NOT NULL DEFAULT 1,
  olusturma INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kurallar_hesap ON kurallar (hesap, aktif);

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

-- Günlük sayaçlar: yorum, ozel_yanit, takip_istendi, teslim
CREATE TABLE IF NOT EXISTS istatistik (
  kural INTEGER NOT NULL,
  gun TEXT NOT NULL,
  tur TEXT NOT NULL,
  adet INTEGER NOT NULL,
  PRIMARY KEY (kural, gun, tur)
);

-- Son olaylar (panelde görünür; kullanıcı adı yazılmaz)
CREATE TABLE IF NOT EXISTS kayit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zaman INTEGER NOT NULL,
  hesap TEXT,
  metin TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ayarlar (ad TEXT PRIMARY KEY, deger TEXT NOT NULL);

-- Gönderilemeyen olayların deneme sayısı: 3 denemeden sonra vazgeçilir
CREATE TABLE IF NOT EXISTS deneme (ozet TEXT PRIMARY KEY, adet INTEGER NOT NULL, zaman INTEGER NOT NULL);

-- Panel girişinde yanlış şifre denemeleri (IP özeti): 15 dakikada 5'ten sonra beklenir
CREATE TABLE IF NOT EXISTS giris_deneme (ip TEXT PRIMARY KEY, adet INTEGER NOT NULL, zaman INTEGER NOT NULL);

-- Teslim edilen linkler: kısa kod → gerçek adres (tıklama sayacı; linkler yeklab.com.tr/l/<kod> olarak gider)
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
