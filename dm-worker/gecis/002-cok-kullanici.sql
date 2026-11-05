-- Tek kullanıcılı (v1) veritabanını çok kullanıcılı yapıya taşır. Bir kez çalıştırılır:
--   npx wrangler d1 execute yeklab-dm --remote --file=gecis/002-cok-kullanici.sql
-- Mevcut hesaplar, kurallar ve şablonlar 1 numaralı atölyeye ("YEK Lab") bağlanır.
-- SIRA ÖNEMLİ: önce bu betik, hemen ardından `npm run deploy`. Aradaki birkaç dakikada eski kod ayar yazamaz (zararsız);
-- yeni kod geçişten önce yayınlanırsa hiçbir sorgu çalışmaz.

CREATE TABLE IF NOT EXISTS atolyeler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad TEXT NOT NULL,
  anahtar TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'ucretsiz',
  aktif INTEGER NOT NULL DEFAULT 1,
  notlar TEXT NOT NULL DEFAULT '',
  olusturma INTEGER NOT NULL,
  son_giris INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO atolyeler (id, ad, anahtar, plan, olusturma)
  VALUES (1, 'YEK Lab', lower(hex(randomblob(16))), 'pro', CAST(strftime('%s','now') AS INTEGER) * 1000);

ALTER TABLE hesaplar ADD COLUMN atolye INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hesaplar ADD COLUMN izinler TEXT NOT NULL DEFAULT '';
ALTER TABLE hesaplar ADD COLUMN son_tarama INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hesaplar ADD COLUMN eklenme INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS hesaplar_atolye ON hesaplar (atolye);

ALTER TABLE kayit ADD COLUMN atolye INTEGER NOT NULL DEFAULT 0;
UPDATE kayit SET atolye = 1 WHERE hesap IS NOT NULL;
CREATE INDEX IF NOT EXISTS kayit_atolye ON kayit (atolye, id);

CREATE TABLE IF NOT EXISTS ayarlar_yeni (atolye INTEGER NOT NULL, ad TEXT NOT NULL, deger TEXT NOT NULL, PRIMARY KEY (atolye, ad));
INSERT OR REPLACE INTO ayarlar_yeni (atolye, ad, deger)
  SELECT CASE WHEN ad = 'son_webhook' OR ad LIKE 'uyari:%' OR ad LIKE 'bildirim_son:%' THEN 0 ELSE 1 END, ad, deger FROM ayarlar;
DROP TABLE ayarlar;
ALTER TABLE ayarlar_yeni RENAME TO ayarlar;

CREATE TABLE IF NOT EXISTS gonderiler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  atolye INTEGER NOT NULL,
  hesap TEXT NOT NULL,
  dosya TEXT NOT NULL,
  ad TEXT NOT NULL,
  boyut INTEGER NOT NULL,
  aciklama TEXT NOT NULL,
  zaman INTEGER NOT NULL,
  feed INTEGER NOT NULL DEFAULT 1,
  durum TEXT NOT NULL DEFAULT 'bekliyor',
  konteyner TEXT,
  medya TEXT,
  kalici TEXT,
  hata TEXT,
  deneme INTEGER NOT NULL DEFAULT 0,
  adim_zamani INTEGER NOT NULL DEFAULT 0,
  kural_anahtar TEXT NOT NULL DEFAULT '',
  kural_baslik TEXT NOT NULL DEFAULT '',
  kural_icerik TEXT NOT NULL DEFAULT '',
  kural_takip INTEGER NOT NULL DEFAULT 1,
  kural INTEGER,
  olusturma INTEGER NOT NULL,
  yayin INTEGER
);
CREATE INDEX IF NOT EXISTS gonderiler_durum ON gonderiler (durum, zaman);
CREATE INDEX IF NOT EXISTS gonderiler_atolye ON gonderiler (atolye, zaman);
