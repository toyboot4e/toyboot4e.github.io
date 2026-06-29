// Dev preview server with live reload — the missing piece that makes `just watch`
// behave like Vite: serve out/ over HTTP and push a reload to the browser the
// instant the warm daemon finishes rebuilding a file.
//
// KEY INVARIANT: the release output in out/ stays byte-for-byte what nix/CI ship.
// The live-reload client is NOT written to disk; it is injected into the HTML
// *as it is streamed* to the browser (see serveFile). So the same out/ you
// preview here is the one that gets deployed — no dev cruft leaks into it.
//
// Transport is Server-Sent Events, not a WebSocket: reload signals only ever
// flow server -> browser (one-way), and SSE gives that with a few lines of plain
// HTTP, no framing code and no dependency — staying true to the hermetic,
// dep-light build. EventSource also reconnects on its own, so a browser tab
// survives a daemon restart and re-attaches when it comes back.
import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";
import { OUT } from "./build.ts";

const SSE_PATH = "/__livereload";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

// The reload client, injected before </body> of every served HTML page. It opens
// the SSE channel and acts on each message:
//   - css   -> re-fetch every stylesheet with a cache-busting query, no navigation
//              (keeps scroll position + open <details> — Vite-style CSS HMR).
//   - reload -> full navigation. A `path` scopes it to the page that changed, so
//              editing article A doesn't reload the tab reading article B; a
//              path-less reload (index/tags/global asset changed) reloads anyone.
const CLIENT = `<script>(function(){
  var here=function(){var p=location.pathname;return p==="/"||p===""?"/index.html":p;};
  var es=new EventSource(${JSON.stringify(SSE_PATH)});
  es.onmessage=function(e){
    var m;try{m=JSON.parse(e.data);}catch(_){return;}
    if(m.type==="css"){
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){
        var u=new URL(l.href,location.href);u.searchParams.set("_lr",String(Date.now()));l.href=u.href;
      });
      return;
    }
    if(m.type==="reload"){
      if(!m.path||m.path===here())location.reload();
    }
  };
})();</script>`;

const clients = new Set<ServerResponse>();

// Reject "../" escapes: resolve under OUT and confirm the result stays inside it.
function resolveSafe(urlPath: string): string | null {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0]));
  const abs = join(OUT, clean);
  if (abs !== OUT && !abs.startsWith(OUT + sep)) return null;
  return abs;
}

async function serveFile(abs: string, res: ServerResponse): Promise<void> {
  // directory -> its index.html (so "/" and "/foo/" work like a static host)
  let target = abs;
  try {
    if ((await stat(target)).isDirectory()) target = join(target, "index.html");
  } catch { /* fall through to the read, which 404s */ }
  const ext = extname(target).toLowerCase();
  try {
    if (ext === ".html") {
      const html = await readFile(target, "utf8");
      const body = html.includes("</body>")
        ? html.replace("</body>", CLIENT + "</body>")
        : html + CLIENT;
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      res.end(body);
      return;
    }
    const buf = await readFile(target);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
}

export type DevServer = {
  /** Push a reload to connected browsers. With `path` (e.g. "/diary/x.html") only
   *  the tab viewing that page reloads; without it, every tab reloads. */
  reload: (path?: string) => void;
  /** Hot-swap stylesheets in place — no navigation, scroll position preserved. */
  cssReload: () => void;
};

function broadcast(msg: object): void {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of clients) c.write(data);
}

export function startDevServer(port: number): DevServer {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === SSE_PATH) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 500\n\n"); // EventSource reconnect backoff
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    const abs = resolveSafe(url);
    if (!abs) { res.writeHead(403); res.end("403 Forbidden"); return; }
    serveFile(abs, res).catch(() => { res.writeHead(500); res.end("500"); });
  });
  server.listen(port, () => {
    console.log(`  live preview: http://localhost:${port}/ (reloads on save)`);
  });
  // Don't let stranded SSE connections keep the process alive past shutdown.
  server.on("close", () => { for (const c of clients) c.end(); clients.clear(); });
  return {
    reload: (path) => broadcast(path ? { type: "reload", path } : { type: "reload" }),
    cssReload: () => broadcast({ type: "css" }),
  };
}
