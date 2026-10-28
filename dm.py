#!/usr/bin/env python3
"""Yorumlara anahtar kelime yazanlara DM ile kaynak gönderir.

Akış:
  1. Paylaşımın açıklamasındaki "yorumlara X yaz" kelimesini (ya da dm/kurallar.json'daki
     anahtarı) yorumlarda arar; eşleşen yoruma tek seferlik özel yanıt (private reply) gider:
     takip ederek bu mesaja yazmasını ister.
  2. Kişi DM'den yazınca takip ediyor mu bakar: ediyorsa kaynakları gönderir, etmiyorsa
     takip etmesini hatırlatır. DM'ye doğrudan anahtar kelime yazanlar da aynı akıştan geçer.

Konuşmanın durumu Instagram'daki mesaj geçmişinden okunur. Depoya (herkese açık) kişisel veri
yazılmaz: dm/durum.json'da yalnızca işlenen yorumların özetleri (hash) ve yorum sayıları durur.

Kullanım:
    python dm.py               # yorumları ve DM'leri işle
    python dm.py --deneme      # gönderilecekleri göster, gönderme
    python dm.py --incele      # yerel rapor: dm/inceleme/ (gitignore'da), hiçbir şey göndermez
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from publish import ROOT, Config, InstagramAPI, load_dotenv, load_posted

DM_DIR = ROOT / "dm"
KURAL_FILE = DM_DIR / "kurallar.json"
# Mac'teki sık çalıştırma (dm-zamanla.sh) kendi durum dosyasını kullanır; depodakiyle çakışmaz
DURUM_FILE = Path(os.environ["DM_DURUM"]) if os.environ.get("DM_DURUM") else DM_DIR / "durum.json"
INCELEME_DIR = DM_DIR / "inceleme"

YORUM_PENCERE = timedelta(days=7)    # özel yanıt yorumdan sonra en geç 7 gün içinde
MESAJ_PENCERE = timedelta(hours=23)  # normal DM, kişinin son mesajından sonra 24 saat içinde
CTA = re.compile(r"yorumlara\s+[\"“”'‘’]?([^\s\"“”'‘’,.!]+)[\"“”'‘’]?\s+yaz", re.I)


def norm(s):
    """Türkçe büyük/küçük harf ve noktalama farkını yok sayar ("Aİ", "aı", "AI!" → "ai")."""
    s = s.replace("İ", "i").replace("I", "i").replace("ı", "i").casefold()
    return " ".join(re.findall(r"\w+", s))


def benzerlik(a, b):
    """İki kelime arasındaki düzenleme uzaklığı (ekleme, silme, değiştirme, yan yana yer değişimi)."""
    d = [[i + j if i * j == 0 else 0 for j in range(len(b) + 1)] for i in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def ozet(*parca):
    return hashlib.sha256("|".join(map(str, parca)).encode()).hexdigest()[:16]


def zaman(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S%z")


def keychain_token():
    try:
        return subprocess.run(
            ["security", "find-generic-password", "-a", "yekvisual/reels-bot", "-s", "reels-bot-ig", "-w"],
            capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


class DM:
    def __init__(self, api: InstagramAPI, kurallar, durum, deneme=False):
        self.api, self.k, self.durum, self.deneme = api, kurallar, durum, deneme
        me = api.get("me", fields="user_id,username")
        self.ben = me["username"]
        self.uid = str(me.get("user_id") or me["id"])
        self.simdi = datetime.now(timezone.utc)
        self.gonderilen = 0

    # --- API ---------------------------------------------------------------------------
    def tumu(self, path, en_cok=500, **params):
        data = self.api.get(path, **params)
        out = list(data.get("data", []))
        gorulen = {x.get("id") for x in out}
        while data.get("paging", {}).get("next") and len(out) < en_cok:
            data = self.api._handle(requests.get(data["paging"]["next"], timeout=60))
            # Konuşma listesi boş ya da tekrar eden sayfalarla "next" vermeye devam edebiliyor
            yeni = [x for x in data.get("data", []) if x.get("id") not in gorulen]
            if not yeni:
                break
            gorulen.update(x.get("id") for x in yeni)
            out += yeni
        return out

    def gonder(self, alici, metin, etiket):
        print(f"  → {etiket}: {metin[:90]!r}")
        if self.deneme:
            return True
        resp = requests.post(self.api._url(f"{self.uid}/messages"), timeout=60,
                             params={"access_token": self.api.cfg.token},
                             json={"recipient": alici, "message": {"text": metin}})
        try:
            self.api._handle(resp)
        except RuntimeError as exc:
            print(f"    gönderilemedi: {exc}")
            return False
        self.gonderilen += 1
        return True

    # --- Kurallar -----------------------------------------------------------------------
    def paylasimlar(self):
        """Kuralı olan paylaşımlar: medya kimliği → kural (anahtar kelimeler dahil)."""
        posted = {e["file"]: e for e in load_posted()}
        medya = self.tumu(f"{self.uid}/media", fields="id,caption,permalink,timestamp,comments_count", limit=50)
        out = {}
        for m in medya:
            kod = (m.get("permalink") or "").rstrip("/").rsplit("/", 1)[-1]
            for kural in self.k["paylasimlar"]:
                video = posted.get(kural.get("video", ""), {})
                aciklama = kural.get("aciklama")
                if kural.get("kod") == kod or (video and video.get("media_id") == m["id"]) \
                        or (aciklama and aciklama in (m.get("caption") or "")):
                    break
            else:
                kural = None
            anahtar = (kural or {}).get("anahtar") or [x.group(1) for x in CTA.finditer(m.get("caption") or "")]
            if isinstance(anahtar, str):
                anahtar = [anahtar]
            out[m["id"]] = {"medya": m, "kod": kod, "kural": kural, "anahtar": [norm(a) for a in anahtar]}
        return out

    def etkin(self, p):
        return p["kural"] and p["kural"].get("aktif", True) and p["anahtar"]

    def eslesir(self, metin, anahtarlar):
        """Anahtar kelime ya da ona benzeyen yazım: ek almış hali (listeyi), uzatılmış harf
        (listeee), tek harf hatası/yer değişimi (lste, lsite). Benzerlik yalnızca kısa yorumlarda
        ve ilk harf tutuyorsa aranır; kısa anahtarlar ("ai") yalnızca birebir eşleşir."""
        n = norm(metin)
        kelimeler = n.split()
        for a in anahtarlar:
            if n == a or a in kelimeler or n.replace(" ", "") == a:
                return True
            if len(a) < 4:
                continue
            for k in kelimeler:
                k = re.sub(r"(.)\1+", r"\1", k)
                if k.startswith(a) or (len(kelimeler) <= 4 and k[:1] == a[:1] and benzerlik(k, a) <= 1):
                    return True
        return False

    # --- 1. Yorumlar --------------------------------------------------------------------
    def yorumlar(self, paylasimlar):
        sayilar = self.durum.setdefault("yorum_sayisi", {})
        islenen = set(self.durum.setdefault("islenen", []))
        for mid, p in paylasimlar.items():
            m = p["medya"]
            if not self.etkin(p) or sayilar.get(mid) == m.get("comments_count"):
                continue
            print(f"{p['kod']} ({m.get('comments_count')} yorum, anahtar: {', '.join(p['anahtar'])})")
            for y in self.tumu(f"{mid}/comments", fields="id,text,timestamp,from", limit=50):
                kim = (y.get("from") or {}).get("username", "")
                if kim == self.ben or self.simdi - zaman(y["timestamp"]) > YORUM_PENCERE:
                    continue
                if not self.eslesir(y.get("text", ""), p["anahtar"]):
                    continue
                h = ozet(y["id"])
                if h in islenen:
                    continue
                sablon = self.k["mesaj"]["takip_iste" if self.k.get("takip_sart", True) else "teslim"]
                metin = sablon.format(baslik=p["kural"]["baslik"], icerik=p["kural"]["icerik"])
                if self.gonder({"comment_id": y["id"]}, metin, "özel yanıt"):
                    islenen.add(h)
            sayilar[mid] = m.get("comments_count")
        self.durum["islenen"] = sorted(islenen)[-5000:]

    # --- 2. DM'ler ----------------------------------------------------------------------
    def konusma(self, cid):
        data = self.api.get(cid, fields="messages{id,created_time,from,to,message}")
        return sorted(data.get("messages", {}).get("data", []), key=lambda x: x["created_time"])

    def bekleyen(self, msjlar, kurallar):
        """Bu kişiye gönderilmesi gereken kurallar: takip sorusu sorulmuş ama teslim edilmemiş
        olanlar; yoksa son mesajlarındaki anahtar kelimeye uyan en yeni paylaşım."""
        bizim = [x for x in msjlar if x["from"].get("username") == self.ben]
        son_biz = bizim[-1]["created_time"] if bizim else ""
        yeni = [x.get("message", "") for x in msjlar if x["from"].get("username") != self.ben and x["created_time"] > son_biz]
        acik = []
        for kural, _ in kurallar:
            link = re.search(r"https?://\S+", kural["icerik"]).group(0)
            soru = [x["created_time"] for x in bizim if kural["baslik"] in x.get("message", "") and "takip" in x.get("message", "")]
            teslim = [x["created_time"] for x in bizim if link in x.get("message", "")]
            if soru and (not teslim or teslim[-1] < soru[-1]):
                acik.append(kural)
        if acik:
            return acik
        # Aynı kelime birden çok paylaşımda olabilir; DM'ye yalnızca "AI" yazan en yeni paylaşımı kastediyordur
        return next(([kural] for kural, anahtar in kurallar if any(self.eslesir(t, anahtar) for t in yeni)), [])

    def dmler(self, paylasimlar):
        kurallar, gorulen = [], set()
        for p in sorted(paylasimlar.values(), key=lambda p: p["medya"]["timestamp"], reverse=True):
            if self.etkin(p) and p["kural"]["baslik"] not in gorulen:
                gorulen.add(p["kural"]["baslik"])
                kurallar.append((p["kural"], p["anahtar"]))
        for c in self.tumu(f"{self.uid}/conversations", platform="instagram", fields="id,updated_time", limit=25, en_cok=50):
            if self.simdi - zaman(c["updated_time"]) > MESAJ_PENCERE:
                break
            msjlar = self.konusma(c["id"])
            if not msjlar or msjlar[-1]["from"].get("username") == self.ben:
                continue
            kisi = msjlar[-1]["from"]
            if self.simdi - zaman(msjlar[-1]["created_time"]) > MESAJ_PENCERE:
                continue
            gerek = self.bekleyen(msjlar, kurallar)
            if not gerek:
                continue
            print(f"Konuşma {ozet(kisi['id'])}: {', '.join(k['baslik'] for k in gerek)}")
            takipci = True
            if self.k.get("takip_sart", True):
                try:
                    takipci = bool(self.api.get(kisi["id"], fields="is_user_follow_business").get("is_user_follow_business"))
                except RuntimeError as exc:
                    print(f"  takip bilgisi alınamadı: {exc}")
                    continue
            if not takipci:
                # DM'ye doğrudan kelime yazana önce takip isteği, soru sorulmuşsa hatırlatma
                soruldu = any(gerek[0]["baslik"] in x.get("message", "") for x in msjlar if x["from"].get("username") == self.ben)
                metin = self.k["mesaj"]["takip_yok"] if soruldu else self.k["mesaj"]["takip_iste"].format(baslik=gerek[0]["baslik"])
                self.gonder({"id": kisi["id"]}, metin, "takip hatırlatma" if soruldu else "takip isteği")
                continue
            for kural in gerek:
                self.gonder({"id": kisi["id"]}, self.k["mesaj"]["teslim"].format(baslik=kural["baslik"], icerik=kural["icerik"]), "teslim")

    # --- Yerel inceleme -----------------------------------------------------------------
    def incele(self, paylasimlar):
        INCELEME_DIR.mkdir(parents=True, exist_ok=True)
        rapor = {"paylasimlar": [], "konusmalar": []}
        for mid, p in paylasimlar.items():
            m = p["medya"]
            yorumlar = self.tumu(f"{mid}/comments", fields="id,text,timestamp,from", limit=50, en_cok=200) if m.get("comments_count") else []
            rapor["paylasimlar"].append({
                "kod": p["kod"], "tarih": m["timestamp"], "anahtar": p["anahtar"], "kural": bool(p["kural"]),
                "yorum": m.get("comments_count"),
                "eslesen_yorum": sum(self.eslesir(y.get("text", ""), p["anahtar"]) for y in yorumlar),
                "son_7_gun_eslesen": sum(self.eslesir(y.get("text", ""), p["anahtar"]) and self.simdi - zaman(y["timestamp"]) <= YORUM_PENCERE for y in yorumlar),
                "aciklama": (m.get("caption") or "")[:300],
            })
        for c in self.tumu(f"{self.uid}/conversations", platform="instagram", fields="id,updated_time", limit=25, en_cok=300):
            msjlar = self.konusma(c["id"])
            if not msjlar:
                continue
            kisi = next((x["from"] for x in msjlar if x["from"].get("username") != self.ben), {})
            rapor["konusmalar"].append({
                "kisi": kisi.get("username"), "guncel": c["updated_time"],
                "cevap_bekliyor": msjlar[-1]["from"].get("username") != self.ben,
                "mesajlar": [{"ben": x["from"].get("username") == self.ben, "t": x["created_time"], "m": x.get("message", "")} for x in msjlar],
            })
        (INCELEME_DIR / "rapor.json").write_text(json.dumps(rapor, ensure_ascii=False, indent=1), encoding="utf-8")
        bekleyen = [k for k in rapor["konusmalar"] if k["cevap_bekliyor"]]
        print(f"{len(rapor['paylasimlar'])} paylaşım, {len(rapor['konusmalar'])} konuşma, "
              f"{len(bekleyen)} cevap bekleyen ({sum(self.simdi - zaman(k['guncel']) <= MESAJ_PENCERE for k in bekleyen)} tanesi 24 saat içinde).")
        print(f"Rapor: {INCELEME_DIR / 'rapor.json'}")


def main():
    parser = argparse.ArgumentParser(description="Yorum → DM yanıtlayıcı")
    parser.add_argument("--deneme", action="store_true", help="gönderilecekleri göster, gönderme")
    parser.add_argument("--incele", action="store_true", help="yerel rapor (dm/inceleme/), göndermez")
    args = parser.parse_args()

    load_dotenv()
    if not os.environ.get("IG_ACCESS_TOKEN"):
        os.environ["IG_ACCESS_TOKEN"] = keychain_token()
    api = InstagramAPI(Config())
    kurallar = json.loads(KURAL_FILE.read_text(encoding="utf-8"))
    durum = json.loads(DURUM_FILE.read_text(encoding="utf-8")) if DURUM_FILE.exists() else {}

    dm = DM(api, kurallar, durum, deneme=args.deneme or args.incele)
    paylasimlar = dm.paylasimlar()
    if args.incele:
        dm.incele(paylasimlar)
        return
    dm.yorumlar(paylasimlar)
    dm.dmler(paylasimlar)
    print(f"{dm.gonderilen} mesaj gönderildi.")
    if not args.deneme:
        DURUM_FILE.write_text(json.dumps(durum, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        sys.exit(f"HATA: {exc}")
