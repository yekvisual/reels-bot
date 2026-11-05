// Herkese açık metin sayfaları: gizlilik, kullanım koşulları, veri silme. Meta App Review bu adresleri ister.

import { Env, urunAdi } from "./db";

const GUNCELLEME = "5 Kasım 2026";

function sayfa(env: Env, baslik: string, govde: string): string {
  const ad = urunAdi(env);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${baslik} · ${ad}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cdefs%3E%3ClinearGradient id=%27g%27 x1=%270%27 y1=%270%27 x2=%271%27 y2=%271%27%3E%3Cstop offset=%270%27 stop-color=%27%23feda75%27/%3E%3Cstop offset=%27.55%27 stop-color=%27%23d62976%27/%3E%3Cstop offset=%271%27 stop-color=%27%234f5bd5%27/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%2724%27 height=%2724%27 rx=%277%27 fill=%27url(%23g)%27/%3E%3Cpath d=%27M13 4 6 14h5l-1 6 8-11h-5z%27 fill=%27%23fff%27/%3E%3C/svg%3E">
<style>
:root{color-scheme:light dark;--m:#1b1a18;--z:#fbfaf8;--s:#6b6a66;--c:#e6e3dd;--v:#2f6bff}
@media(prefers-color-scheme:dark){:root{--m:#ecebe8;--z:#131313;--s:#a3a19c;--c:#2a2a2a;--v:#7ea2ff}}
body{margin:0;background:var(--z);color:var(--m);font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:680px;margin:0 auto;padding:48px 20px 80px}
h1{font-size:30px;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px}
p,li{color:var(--m)}.not{color:var(--s);font-size:14px}a{color:var(--v);text-decoration:none}a:hover{text-decoration:underline}
nav{display:flex;gap:16px;font-size:14px;margin-bottom:28px;flex-wrap:wrap}ul{padding-left:20px}
.kutu{border:1px solid var(--c);border-radius:12px;padding:16px 18px;margin:16px 0}
</style></head><body><main>
<nav><a href="/">${ad}</a><a href="/gizlilik">Gizlilik</a><a href="/kosullar">Kullanım koşulları</a><a href="/veri-silme">Veri silme</a></nav>
<h1>${baslik}</h1><p class="not">Son güncelleme: ${GUNCELLEME}</p>
${govde}
</main></body></html>`;
}

export const GIZLILIK = (env: Env) => sayfa(env, "Gizlilik politikası", `
<p>${urunAdi(env)}, Instagram'da içerik üreten kişi ve işletmelerin ("kullanıcı") paylaşımlarını planlayıp yayınlamasına ve
paylaşımlarına yorum yazan ya da mesaj gönderen takipçilerine ("kişi") istedikleri bağlantıları otomatik olarak göndermesine yarar.
Bu sayfa hangi verilerin, neden ve ne kadar süreyle tutulduğunu açıklar.</p>

<h2>Kullanıcıdan tutulan veriler</h2>
<ul>
<li>Instagram ile giriş yapıldığında Instagram'ın verdiği hesap kimliği, kullanıcı adı ve erişim anahtarı. Anahtar yalnızca kullanıcının adına
Instagram API'sine istek atmak için kullanılır; üçüncü kişilerle paylaşılmaz.</li>
<li>Kullanıcının kendisinin yazdığı otomasyon kuralları, mesaj şablonları, gönderi açıklamaları ve yüklediği videolar. Videolar yayınlandıktan sonra depodan silinir.</li>
<li>Olay günlüğü: hangi işlemin ne zaman yapıldığı (ör. "link gönderildi"). Günlük 90 gün sonra silinir.</li>
</ul>

<h2>Kişilerden (takipçilerden) tutulan veriler</h2>
<ul>
<li>Bağlantı isteyen ya da mesaj yazan kişinin Instagram kullanıcı adı, görünen adı, uygulamaya özel kimliği, ilk ve son etkileşim zamanı,
takip durumu ve hangi bağlantıların ne zaman gönderildiği. Bu kayıtlar 12 ay sonra kendiliğinden silinir ve yalnızca ilgili hesabın sahibi görebilir.</li>
<li>Yorum ve mesaj metinleri saklanmaz. Aynı yoruma iki kez yanıt gitmemesi için yalnızca geri çevrilemeyen özetler (hash) tutulur ve 30 gün içinde silinir.</li>
<li>Gönderilen bağlantılara tıklama sayılır; IP adresi saklanmaz, yalnızca aynı gün tekrarları ayırt etmek için özeti tutulur.</li>
</ul>

<h2>Verilerin kullanımı</h2>
<p>Veriler yalnızca hizmeti sunmak, hangi içeriklerin ilgi gördüğünü hesap sahibine göstermek ve hataları gidermek için kullanılır.
Reklam amacıyla kullanılmaz, satılmaz, üçüncü kişilerle paylaşılmaz. Veriler Cloudflare altyapısında (Avrupa Birliği ve küresel uç noktalar) saklanır.
Instagram ile iletişim Meta Platforms'un Instagram API'si üzerinden, Meta'nın <a href="https://developers.facebook.com/terms/" rel="noopener">Platform Koşulları</a>'na uygun olarak yapılır.</p>

<h2>Verilerin silinmesi</h2>
<ul>
<li><b>Kişiler:</b> Instagram'da ilgili hesaba DM'den "verilerimi sil" yazmanız yeterli; kaydınız hemen silinir ve size bilgi verilir.</li>
<li><b>Kullanıcılar:</b> Panelden hesabı kaldırdığınızda ya da Instagram ayarlarından uygulamanın yetkisini aldığınızda hesap, kurallar, kişiler ve istatistikler silinir.
Ayrıntı: <a href="/veri-silme">veri silme</a>.</li>
</ul>

<h2>İletişim</h2>
<p>Sorularınız için: ${env.ILETISIM ? `<a href="mailto:${env.ILETISIM}">${env.ILETISIM}</a>` : "panelden yöneticiye yazın"}.
6698 sayılı KVKK kapsamındaki başvurularınız aynı adrese yapılabilir.</p>
`);

export const KOSULLAR = (env: Env) => sayfa(env, "Kullanım koşulları", `
<p>${urunAdi(env)} hizmetini ("hizmet") kullanarak aşağıdaki koşulları kabul etmiş olursunuz.</p>

<h2>Hizmet</h2>
<ul>
<li>Hizmet, Instagram profesyonel hesaplarınız için gönderi planlama ve yorum/mesaj otomasyonu sunar. Instagram ile giriş yaparak hesabınızı bağlarsınız; istediğiniz zaman kaldırabilirsiniz.</li>
<li>Otomasyonun gönderdiği her mesajın içeriğinden ve yüklediğiniz videoların haklarından siz sorumlusunuz. Spam, yanıltıcı içerik ve Instagram'ın
<a href="https://help.instagram.com/581066165581870" rel="noopener">Topluluk Kuralları</a>'na aykırı kullanım yasaktır; böyle kullanımda hesap durdurulabilir.</li>
<li>Hizmet, Meta'nın API'sine ve kurallarına bağlıdır. Meta'nın kesintileri, sınırları ya da politika değişiklikleri nedeniyle oluşan aksamalar hizmetin kusuru sayılmaz.</li>
</ul>

<h2>Sorumluluk</h2>
<p>Hizmet "olduğu gibi" sunulur. Makul özen gösterilmesine rağmen gönderinin zamanında yayınlanamaması, mesajın gitmemesi ya da veri kaybı
gibi durumlarda hizmetin sorumluluğu, varsa, son bir ayda ödenen ücretle sınırlıdır.</p>

<h2>Ücret</h2>
<p>Hizmet şu an davetli kullanıcılara ücretsiz sunulmaktadır. Ücretli plan açıldığında koşulları bu sayfada duyurulur; mevcut kullanıcılar önceden bilgilendirilir.</p>

<h2>Değişiklik ve iletişim</h2>
<p>Koşullar güncellenebilir; önemli değişiklikler panelde duyurulur. İletişim: ${env.ILETISIM ? `<a href="mailto:${env.ILETISIM}">${env.ILETISIM}</a>` : "panel üzerinden"}.</p>
`);

export const VERI_SILME = (env: Env, kod: string, sonuc: { zaman: number; bulundu: boolean } | null) => sayfa(env, "Veri silme", `
${kod ? `<div class="kutu">${sonuc
    ? `<b>Silme isteği tamamlandı.</b> Onay kodu <code>${kod}</code> · ${new Date(sonuc.zaman).toLocaleString("tr-TR")}.
       ${sonuc.bulundu ? "Hesap ve ona bağlı tüm kayıtlar silindi." : "Bu hesaba ait kayıt zaten yoktu."}`
    : `<b>Bu onay koduna ait kayıt bulunamadı.</b> Kod yanlış olabilir ya da istek bize ulaşmamış olabilir.`}</div>` : ""}

<h2>Hesabınızı ve verilerinizi silmek için</h2>
<ul>
<li><b>Panelden:</b> Ayarlar → Hesaplar → "Kaldır". Hesap, kurallar, kişiler, gönderiler ve istatistikler hemen silinir.</li>
<li><b>Instagram'dan:</b> Ayarlar → Web sitesi izinleri → Uygulamalar ve web siteleri → ${urunAdi(env)} → Kaldır. Meta bize haber verir, verileriniz silinir
ve bu sayfada görebileceğiniz bir onay kodu üretilir.</li>
<li><b>E-postayla:</b> ${env.ILETISIM ? `<a href="mailto:${env.ILETISIM}">${env.ILETISIM}</a>` : "yöneticiye"} Instagram kullanıcı adınızla yazın; 7 gün içinde silinir ve size bilgi verilir.</li>
</ul>

<h2>Takipçiyseniz</h2>
<p>Bir hesaptan otomatik mesaj aldıysanız ve kaydınızın silinmesini istiyorsanız, o hesaba DM'den <b>"verilerimi sil"</b> yazmanız yeterlidir;
kayıt anında silinir ve size bilgi verilir.</p>
`);
