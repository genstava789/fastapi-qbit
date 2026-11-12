/**
 * Cloudflare Worker: Edge Download Proxy & Static Assets SPA Router
 *
 * Provides accelerated edge downloads for Google Drive files:
 *  - GET /download.aspx?id={file_id}&name={filename}
 *  - GET /proxy/download?id={file_id}&name={filename}
 *  - GET /proxy/stream/{file_id}
 *
 * Forwarding Range headers enables multi-threaded chunked downloads (e.g. IDM)
 * and seamless seeking in HTML5 audio/video preview players.
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DEFAULT_BACKEND_URL?: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx?: unknown): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS Preflight Handling ─────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ── Cloudflare Edge Download Proxy ──────────────────────────────────────
    const isDownloadAspx = url.pathname === "/download.aspx";
    const isProxyDownload = url.pathname === "/proxy/download";
    const isProxyStream = url.pathname.startsWith("/proxy/stream/") || url.pathname.startsWith("/api/proxy/stream/");

    if (isDownloadAspx || isProxyDownload || isProxyStream) {
      let fileId = url.searchParams.get("id");
      if (!fileId && isProxyStream) {
        fileId = url.pathname.split("/").pop() || null;
      }

      const filename = url.searchParams.get("name") || "download";
      const backendBase =
        url.searchParams.get("backend") ||
        env.DEFAULT_BACKEND_URL ||
        "https://mild-leaf.nyc.boxd.sh";

      if (!fileId) {
        return new Response("Missing 'id' parameter for download.", {
          status: 400,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Target streaming endpoint on FastAPI backend
      const streamTargetUrl = `${backendBase.replace(/\/+$/, "")}/api/v1/drive/stream/${encodeURIComponent(fileId)}`;

      // Forward client Range header to backend for accelerated seek and chunking
      const forwardHeaders = new Headers();
      const clientRange = request.headers.get("range");
      if (clientRange) {
        forwardHeaders.set("Range", clientRange);
      }

      try {
        const backendResp = await fetch(streamTargetUrl, {
          method: "GET",
          headers: forwardHeaders,
        });

        // If backend returned error, pass through the response
        if (!backendResp.ok && backendResp.status !== 206) {
          const errText = await backendResp.text();
          return new Response(errText, {
            status: backendResp.status,
            statusText: backendResp.statusText,
            headers: {
              "Content-Type": backendResp.headers.get("Content-Type") || "text/plain",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        // Build accelerated edge response
        const respHeaders = new Headers(backendResp.headers);
        respHeaders.set("Access-Control-Allow-Origin", "*");
        respHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        respHeaders.set(
          "Access-Control-Expose-Headers",
          "Content-Length, Content-Range, Accept-Ranges, Content-Disposition"
        );
        respHeaders.set("Accept-Ranges", "bytes");
        respHeaders.set("X-Accelerated-By", "Cloudflare Workers Edge");
        respHeaders.set("Cache-Control", "public, max-age=3600");

        // Force clean content-disposition if requested
        if (!respHeaders.has("Content-Disposition")) {
          respHeaders.set(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(filename)}"`
          );
        }

        return new Response(backendResp.body, {
          status: backendResp.status,
          statusText: backendResp.statusText,
          headers: respHeaders,
        });
      } catch (err: any) {
        return new Response(
          `Cloudflare Worker Download Proxy Error: ${err?.message || String(err)}`,
          {
            status: 502,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    // ── Default: Serve Single Page Application (SPA) Static Assets ──────────
    return env.ASSETS.fetch(request);
  },
};
