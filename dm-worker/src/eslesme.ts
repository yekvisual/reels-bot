// dm.py'deki eşleşme kuralları, birebir.

/** Türkçe büyük/küçük harf ve noktalama farkını yok sayar ("Aİ", "aı", "AI!" → "ai"). */
export function norm(s: string): string {
  s = s.replace(/[İIı]/g, "i").toLowerCase();
  return (s.match(/[\p{L}\p{N}_]+/gu) ?? []).join(" ");
}

/** İki kelime arasındaki düzenleme uzaklığı (ekleme, silme, değiştirme, yan yana yer değişimi). */
export function benzerlik(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i * j === 0 ? i + j : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Anahtar kelime ya da ona benzeyen yazım: ek almış hali (listeyi), uzatılmış harf (listeee),
 *  tek harf hatası/yer değişimi (lste, lsite). Benzerlik yalnızca kısa yorumlarda ve ilk harf
 *  tutuyorsa aranır; kısa anahtarlar ("ai") yalnızca birebir eşleşir. */
export function eslesir(metin: string, anahtarlar: string[]): boolean {
  const n = norm(metin);
  const kelimeler = n.split(" ").filter(Boolean);
  for (const a of anahtarlar) {
    if (n === a || kelimeler.includes(a) || n.replaceAll(" ", "") === a) return true;
    if (a.length < 4) continue;
    for (let k of kelimeler) {
      k = k.replace(/(.)\1+/gu, "$1");
      if (k.startsWith(a) || (kelimeler.length <= 4 && k[0] === a[0] && benzerlik(k, a) <= 1)) return true;
    }
  }
  return false;
}

/** DM için sıkı eşleşme: mesaj anahtar kelimenin kendisi ya da en çok 3 kelimelik bir mesajda
 *  kelime birebir geçiyor ("liste", "liste lütfen", "merhaba liste"). "listeyi gördüm harika" ya da
 *  "linki nereden bulurum" gibi sıradan cümleler eşleşmez; esnek eşleşme yalnızca yorumlarda. */
export function eslesirKesin(metin: string, anahtarlar: string[]): boolean {
  const n = norm(metin);
  const kelimeler = n.split(" ").filter(Boolean);
  if (!kelimeler.length || kelimeler.length > 3) return false;
  return anahtarlar.some((a) => n === a || n.replaceAll(" ", "") === a || kelimeler.includes(a));
}

export function anahtarlar(virgullu: string): string[] {
  return virgullu.split(",").map(norm).filter(Boolean);
}
