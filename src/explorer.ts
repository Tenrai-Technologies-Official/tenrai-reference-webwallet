let explorer = "https://explorer.tenrai-technologies.org";

// Explorer links use the public explorer until /api/config names the server's own.
void fetch("/api/config")
  .then((response) => (response.ok ? (response.json() as Promise<{ explorer_url?: unknown }>) : undefined))
  .then((config) => {
    const url = typeof config?.explorer_url === "string" ? new URL(config.explorer_url) : undefined;
    if (url && (url.protocol === "https:" || url.protocol === "http:")) {
      explorer = url.href.replace(/\/+$/, "");
    }
  })
  .catch(() => undefined);

export function transactionUrl(id: string): string {
  return `${explorer}/#/tx/${id}`;
}

export function cutUrl(height: number): string {
  return `${explorer}/#/cut/${height}`;
}

export function addressUrl(address: string): string {
  return `${explorer}/#/address/${address}`;
}
