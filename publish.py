#!/usr/bin/env python3
"""Instagram Reels otomatik paylaşım botu.

videos/ klasöründeki sıradaki (henüz paylaşılmamış) videoyu resmi Instagram
API'si ile Reels olarak paylaşır ve posted.json'a kaydeder.

Kullanım:
    python publish.py              # sıradaki videoyu paylaş
    python publish.py --check      # token / hesap / kota kontrolü
    python publish.py --dry-run    # ne paylaşılacağını göster, paylaşma
    python publish.py --file videos/ornek.mp4   # belirli bir videoyu paylaş
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent
VIDEOS_DIR = ROOT / "videos"
POSTED_FILE = ROOT / "posted.json"
VIDEO_EXTS = {".mp4", ".mov"}


def load_dotenv():
    """Yerel kullanım için .env dosyasını okur (GitHub'da secrets kullanılır)."""
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class Config:
    def __init__(self):
        self.token = os.environ.get("IG_ACCESS_TOKEN", "").strip()
        if not self.token:
            sys.exit("HATA: IG_ACCESS_TOKEN tanımlı değil (.env veya GitHub secret).")
        # instagram = Instagram Login (graph.instagram.com, Facebook sayfası gerekmez)
        # facebook  = Facebook Login (graph.facebook.com, IG hesabı bir FB sayfasına bağlı)
        self.api = os.environ.get("IG_API", "instagram").lower()
        self.version = os.environ.get("GRAPH_VERSION", "v26.0")
        self.host = "https://graph.facebook.com" if self.api == "facebook" else "https://graph.instagram.com"
        self.user_id = os.environ.get("IG_USER_ID", "").strip()
        # url       = Instagram videoyu herkese açık bir URL'den indirir
        # resumable = video doğrudan dosyadan yüklenir (yalnızca IG_API=facebook)
        default_mode = "resumable" if self.api == "facebook" else "url"
        self.upload_mode = os.environ.get("UPLOAD_MODE", default_mode).lower()
        self.video_base_url = os.environ.get("VIDEO_BASE_URL", "").strip()
        if not self.video_base_url and os.environ.get("GITHUB_REPOSITORY"):
            repo = os.environ["GITHUB_REPOSITORY"]
            branch = os.environ.get("GITHUB_REF_NAME", "main")
            self.video_base_url = f"https://raw.githubusercontent.com/{repo}/{branch}/"
        self.share_to_feed = os.environ.get("SHARE_TO_FEED", "true").lower() != "false"


class InstagramAPI:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def _url(self, path):
        return f"{self.cfg.host}/{self.cfg.version}/{path}"

    def _handle(self, resp):
        try:
            data = resp.json()
        except ValueError:
            resp.raise_for_status()
            raise
        if resp.status_code >= 400 or "error" in data:
            err = data.get("error", data)
            raise RuntimeError(f"Instagram API hatası ({resp.status_code}): {json.dumps(err, ensure_ascii=False)}")
        return data

    def get(self, path, **params):
        params["access_token"] = self.cfg.token
        return self._handle(requests.get(self._url(path), params=params, timeout=60))

    def post(self, path, **data):
        data["access_token"] = self.cfg.token
        return self._handle(requests.post(self._url(path), data=data, timeout=120))

    def user_id(self):
        if self.cfg.user_id:
            return self.cfg.user_id
        if self.cfg.api == "facebook":
            sys.exit("HATA: IG_API=facebook için IG_USER_ID tanımlanmalı.")
        me = self.get("me", fields="user_id,username")
        self.cfg.user_id = str(me.get("user_id") or me["id"])
        return self.cfg.user_id

    def account_info(self):
        uid = self.user_id()
        info = self.get(uid, fields="username,account_type,media_count")
        limit = self.get(f"{uid}/content_publishing_limit", fields="config,quota_usage")
        return info, limit

    def create_reel_container(self, video: Path, caption: str):
        uid = self.user_id()
        params = {
            "media_type": "REELS",
            "caption": caption,
            "share_to_feed": "true" if self.cfg.share_to_feed else "false",
        }
        if self.cfg.upload_mode == "resumable":
            params["upload_type"] = "resumable"
        else:
            params["video_url"] = self.public_url(video)
        return self.post(f"{uid}/media", **params)["id"]

    def public_url(self, video: Path):
        if not self.cfg.video_base_url:
            sys.exit(
                "HATA: UPLOAD_MODE=url için VIDEO_BASE_URL gerekli "
                "(GitHub Actions'ta herkese açık repoda otomatik ayarlanır)."
            )
        rel = video.relative_to(ROOT).as_posix()
        return self.cfg.video_base_url.rstrip("/") + "/" + quote(rel)

    def upload_file(self, container_id: str, video: Path):
        url = f"https://rupload.facebook.com/ig-api-upload/{self.cfg.version}/{container_id}"
        headers = {
            "Authorization": f"OAuth {self.cfg.token}",
            "offset": "0",
            "file_size": str(video.stat().st_size),
        }
        with video.open("rb") as fh:
            resp = requests.post(url, headers=headers, data=fh, timeout=900)
        data = self._handle(resp)
        if not data.get("success", True):
            raise RuntimeError(f"Yükleme başarısız: {data}")

    def wait_until_ready(self, container_id: str, timeout_s=900, interval_s=20):
        deadline = time.time() + timeout_s
        while True:
            data = self.get(container_id, fields="status_code,status")
            code = data.get("status_code")
            print(f"  durum: {code}")
            if code == "FINISHED":
                return
            if code in ("ERROR", "EXPIRED"):
                raise RuntimeError(f"Video işlenemedi: {data.get('status', code)}")
            if time.time() > deadline:
                raise RuntimeError("Video işleme zaman aşımına uğradı.")
            time.sleep(interval_s)

    def publish(self, container_id: str):
        uid = self.user_id()
        media_id = self.post(f"{uid}/media_publish", creation_id=container_id)["id"]
        try:
            permalink = self.get(media_id, fields="permalink").get("permalink")
        except RuntimeError:
            permalink = None
        return media_id, permalink


def load_posted():
    if POSTED_FILE.exists():
        return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    return []


def save_posted(entries):
    POSTED_FILE.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def next_video(posted):
    done = {e["file"] for e in posted}
    candidates = sorted(
        p for p in VIDEOS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS
    ) if VIDEOS_DIR.exists() else []
    for video in candidates:
        if video.relative_to(ROOT).as_posix() not in done:
            return video
    return None


def caption_for(video: Path):
    sidecar = video.with_suffix(".txt")
    if sidecar.exists():
        return sidecar.read_text(encoding="utf-8").strip()
    return os.environ.get("DEFAULT_CAPTION", "")


def main():
    parser = argparse.ArgumentParser(description="Instagram Reels otomatik paylaşım")
    parser.add_argument("--check", action="store_true", help="token ve hesap kontrolü")
    parser.add_argument("--dry-run", action="store_true", help="paylaşmadan sıradaki videoyu göster")
    parser.add_argument("--file", default=os.environ.get("REEL_FILE") or None, help="belirli bir video")
    args = parser.parse_args()

    load_dotenv()
    posted = load_posted()

    if args.file:
        video = (ROOT / args.file).resolve()
        if not video.exists():
            sys.exit(f"HATA: dosya bulunamadı: {args.file}")
    else:
        video = next_video(posted)

    if args.dry_run:
        if not video:
            print("Sırada paylaşılacak video yok.")
            return
        print(f"Sıradaki video : {video.relative_to(ROOT)}")
        print(f"Boyut          : {video.stat().st_size / 1_048_576:.1f} MB")
        print(f"Açıklama       : {caption_for(video)!r}")
        return

    cfg = Config()
    api = InstagramAPI(cfg)

    if args.check:
        info, limit = api.account_info()
        print(f"Hesap   : @{info.get('username')} ({info.get('account_type')})")
        print(f"Gönderi : {info.get('media_count')}")
        print(f"Kota    : {json.dumps(limit.get('data', limit), ensure_ascii=False)}")
        return

    if not video:
        print("Sırada paylaşılacak video yok. videos/ klasörüne yeni video ekleyin.")
        return

    rel = video.relative_to(ROOT).as_posix()
    caption = caption_for(video)
    print(f"Paylaşılıyor: {rel} ({video.stat().st_size / 1_048_576:.1f} MB)")

    container_id = api.create_reel_container(video, caption)
    print(f"  container: {container_id}")
    if cfg.upload_mode == "resumable":
        print("  dosya yükleniyor...")
        api.upload_file(container_id, video)
    api.wait_until_ready(container_id)
    media_id, permalink = api.publish(container_id)
    print(f"Paylaşıldı: {permalink or media_id}")

    posted.append({
        "file": rel,
        "media_id": media_id,
        "permalink": permalink,
        "posted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    save_posted(posted)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        sys.exit(f"HATA: {exc}")
