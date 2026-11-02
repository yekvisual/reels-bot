// Instagram Graph API (Instagram Login, graph.instagram.com)

const KOK = "https://graph.instagram.com";
const SURUM = "v26.0";

export class IG {
  constructor(private token: string) {}

  private async cevap(resp: Response): Promise<any> {
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) {
      const e = data.error ?? {};
      throw new Error(`${e.message ?? resp.statusText} (kod ${e.code ?? resp.status}${e.error_subcode ? "/" + e.error_subcode : ""})`);
    }
    return data;
  }

  async get(yol: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(yol.startsWith("http") ? yol : `${KOK}/${SURUM}/${yol}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", this.token);
    return this.cevap(await fetch(url));
  }

  async post(yol: string, govde: object): Promise<any> {
    return this.cevap(await fetch(`${KOK}/${SURUM}/${yol}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(govde),
    }));
  }

  async sil(yol: string, govde: object): Promise<any> {
    return this.cevap(await fetch(`${KOK}/${SURUM}/${yol}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(govde),
    }));
  }

  /** Sayfalı listeyi en çok `enCok` kayda kadar toplar; `dur` sayfanın son kaydı için true dönerse
   *  sonraki sayfalar çekilmez (liste en yeniden eskiye sıralıysa eski kayıtlar atlanır). */
  async tumu(yol: string, params: Record<string, string>, enCok = 300, dur?: (kayit: any) => boolean): Promise<any[]> {
    let data = await this.get(yol, params);
    const out: any[] = [...(data.data ?? [])];
    while (data.paging?.next && out.length < enCok && !(dur && out.length && dur(out[out.length - 1]))) {
      data = await this.get(data.paging.next);
      if (!data.data?.length) break;
      out.push(...data.data);
    }
    return out;
  }

  /** Uzun ömürlü tokenı 60 gün uzatır. */
  async yenile(): Promise<string> {
    const url = new URL(`${KOK}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", this.token);
    return (await this.cevap(await fetch(url))).access_token;
  }
}

/** Instagram'ın "2026-10-30T10:00:00+0000" biçimini ms'ye çevirir. */
export function zaman(s: string): number {
  return Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
}
