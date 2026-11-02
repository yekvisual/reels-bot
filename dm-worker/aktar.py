#!/usr/bin/env python3
"""dm/kurallar.json'daki kuralları Worker veritabanına aktarmak için SQL üretir.

Paylaşımlar dm.py'deki gibi bulunur (video, kod ya da açıklama); çıktı ekrana yazılır:
    python3 dm-worker/aktar.py > /tmp/kurallar.sql
    npx wrangler d1 execute yeklab-dm --remote --file=/tmp/kurallar.sql   (dm-worker içinde)
"""

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dm import CTA, DM, KURAL_FILE, keychain_token, norm  # noqa: E402
from publish import ROOT, Config, InstagramAPI, load_dotenv  # noqa: E402


def sql(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    load_dotenv()
    if not os.environ.get("IG_ACCESS_TOKEN"):
        os.environ["IG_ACCESS_TOKEN"] = keychain_token()
    kurallar = json.loads(KURAL_FILE.read_text(encoding="utf-8"))
    dm = DM(InstagramAPI(Config()), kurallar, {}, deneme=True)
    simdi = int(time.time() * 1000)
    satirlar, bagli = [], set()
    for mid, p in sorted(dm.paylasimlar().items(), key=lambda x: x[1]["medya"]["timestamp"]):
        if p["kural"]:
            bagli.add(id(p["kural"]))
            satirlar.append((p["kural"], mid, p["anahtar"], p["kod"]))
    # Henüz paylaşılmamış videolar: açıklamanın ilk satırıyla bekler, paylaşılınca Worker bağlar
    for k in kurallar["paylasimlar"]:
        txt = ROOT / Path(k.get("video", "-")).with_suffix(".txt")
        if id(k) in bagli or not txt.exists():
            continue
        aciklama = txt.read_text(encoding="utf-8")
        anahtar = k.get("anahtar") or [x.group(1) for x in CTA.finditer(aciklama)]
        satirlar.append((k, "aciklama:" + aciklama.strip().splitlines()[0].strip(), [norm(a) for a in anahtar], "bekliyor"))
    for i, (k, medya, anahtar, kod) in enumerate(satirlar):
        deger = [dm.uid, medya, ", ".join(anahtar), k["baslik"], k["icerik"],
                 int(kurallar.get("takip_sart", True)), 1, int(k.get("aktif", True)), simdi + i]
        print("INSERT INTO kurallar (hesap, medya, anahtar, baslik, icerik, takip_sart, yorum_yaniti, aktif, olusturma) "
              f"VALUES ({', '.join(sql(d) if isinstance(d, str) else str(d) for d in deger)});")
        print(f"-- {kod}: {k['baslik']} ({', '.join(anahtar)}) → {medya}", file=sys.stderr)


if __name__ == "__main__":
    main()
