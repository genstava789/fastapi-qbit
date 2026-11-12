/**
 * Cloudflare Worker: Edge Download Proxy & Static Assets SPA Router
 * Reference & architecture inspired by: GoogleDriveIndex (GDI)
 * https://gitlab.com/GoogleDriveIndex/Google-Drive-Index
 *
 * Supported Routes:
 *  - GET /file/:fileId/:fileName   -> Direct edge stream & download from Google Drive API v3
 *  - GET /file/:fileId/:fileName?view=1 -> Serve interactive Preview UI (SPA)
 *  - GET /preview/:fileId/:fileName     -> Serve interactive Preview UI (SPA)
 *  - GET /download.aspx?id=:id&name=:name -> Direct edge download (GDI style)
 *  - GET /proxy/stream/:fileId           -> Inline stream for HTML5 players
 *  - Default                             -> Serve SPA static assets
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DEFAULT_BACKEND_URL?: string;
  GDRIVE_CLIENT_ID?: string;
  GDRIVE_CLIENT_SECRET?: string;
  GDRIVE_REFRESH_TOKEN?: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

// In-memory token cache in the Cloudflare Worker isolate
let cachedToken: TokenCache | null = null;

// Supported Google Workspace export formats
const GDOC_EXPORT_FORMATS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.drawing": { mime: "image/png", ext: "png" },
};

/**
 * Obtain a valid Google Drive OAuth access token.
 */
async function getAccessToken(backendBase: string, env: Env, forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now + 60000) {
    return cachedToken.accessToken;
  }

  // 1. Direct refresh if Worker environment contains OAuth secrets
  if (env.GDRIVE_REFRESH_TOKEN && env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET) {
    try {
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GDRIVE_CLIENT_ID,
          client_secret: env.GDRIVE_CLIENT_SECRET,
          refresh_token: env.GDRIVE_REFRESH_TOKEN,
          grant_type: "refresh_token",
        }),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        if (data.access_token) {
          const expiresIn = data.expires_in || 3600;
          cachedToken = {
            accessToken: data.access_token,
            expiresAt: now + (expiresIn - 300) * 1000,
          };
          return data.access_token;
        }
      }
    } catch (e) {
      console.warn("Direct OAuth refresh failed, falling back to backend:", e);
    }
  }

  // 2. Retrieve active token from FastAPI backend
  const tokenUrl = `${backendBase.replace(/\/+$/, "")}/api/v1/drive/token`;
  const resp = await fetch(tokenUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `Failed to fetch Google Drive token from backend (${resp.status}): ${errText || resp.statusText}`
    );
  }

  const tokenData: any = await resp.json();
  if (!tokenData.access_token) {
    throw new Error("Backend response did not include a valid Google Drive access_token");
  }

  cachedToken = {
    accessToken: tokenData.access_token,
    expiresAt: now + 3000 * 1000, // cache for 50 minutes
  };

  return tokenData.access_token;
}

/**
 * Fetch file metadata from Google Drive API v3
 */
async function fetchFileMetadata(fileId: string, token: string): Promise<any | null> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?fields=id,name,mimeType,size,fileExtension&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

/**
 * Stream file directly from Google Drive API v3 alt=media
 */
async function streamGoogleDriveFile(
  fileId: string,
  explicitFileName: string | null,
  isInline: boolean,
  exportFmt: string | null,
  backendBase: string,
  env: Env,
  request: Request
): Promise<Response> {
  const clientRange = request.headers.get("Range");

  try {
    let token = await getAccessToken(backendBase, env);
    let meta = await fetchFileMetadata(fileId, token);

    // If metadata fetch failed with 401, refresh token and retry
    if (!meta) {
      token = await getAccessToken(backendBase, env, true);
      meta = await fetchFileMetadata(fileId, token);
    }

    const fileName = explicitFileName || meta?.name || `file_${fileId}`;
    const mimeType = meta?.mimeType || "application/octet-stream";

    // Handle Google Workspace documents (Docs, Sheets, Slides) via Export API
    const exportEntry = GDOC_EXPORT_FORMATS[mimeType];
    if (exportEntry) {
      const targetFmt = exportFmt || exportEntry.ext;
      const exportMime = exportEntry.mime;
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}/export?mimeType=${encodeURIComponent(exportMime)}`;

      const exportResp = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!exportResp.ok) {
        const errText = await exportResp.text();
        return new Response(
          JSON.stringify({
            error: `Failed to export Google Workspace file: ${errText}`,
            status: exportResp.status,
          }),
          {
            status: exportResp.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      const exportFileName = fileName.endsWith(`.${targetFmt}`)
        ? fileName
        : `${fileName}.${targetFmt}`;
      const cleanAscii = exportFileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "");
      const utf8Encoded = encodeURIComponent(exportFileName);

      const exportHeaders = new Headers(exportResp.headers);
      exportHeaders.set(
        "Content-Disposition",
        isInline
          ? `inline; filename="${cleanAscii}"; filename*=UTF-8''${utf8Encoded}`
          : `attachment; filename="${cleanAscii}"; filename*=UTF-8''${utf8Encoded}`
      );
      exportHeaders.set("Content-Type", exportMime);
      exportHeaders.set("Access-Control-Allow-Origin", "*");
      exportHeaders.set("Cache-Control", "public, max-age=3600");

      return new Response(exportResp.body, {
        status: 200,
        headers: exportHeaders,
      });
    }

    // Direct Google Drive API v3 alt=media binary streaming (GDI architecture)
    const gdriveMediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?alt=media&supportsAllDrives=true`;

    const driveHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (clientRange) {
      driveHeaders["Range"] = clientRange;
    }

    let gdriveResp = await fetch(gdriveMediaUrl, {
      method: "GET",
      headers: driveHeaders,
    });

    // If 401 Unauthorized, refresh token and retry once
    if (gdriveResp.status === 401) {
      token = await getAccessToken(backendBase, env, true);
      driveHeaders["Authorization"] = `Bearer ${token}`;
      gdriveResp = await fetch(gdriveMediaUrl, {
        method: "GET",
        headers: driveHeaders,
      });
    }

    // If Google Drive returned an error status (e.g. 404, 403)
    if (!gdriveResp.ok && gdriveResp.status !== 206) {
      const errBody = await gdriveResp.text();

      // Graceful fallback to backend stream endpoint if direct edge fetch failed
      const fallbackUrl = `${backendBase.replace(/\/+$/, "")}/api/v1/drive/stream/${encodeURIComponent(fileId)}`;
      const fallbackHeaders: Record<string, string> = {};
      if (clientRange) fallbackHeaders["Range"] = clientRange;

      const backendResp = await fetch(fallbackUrl, {
        headers: fallbackHeaders,
      });

      if (backendResp.ok || backendResp.status === 206) {
        const fbHeaders = new Headers(backendResp.headers);
        fbHeaders.set("Access-Control-Allow-Origin", "*");
        fbHeaders.set("X-Stream-Source", "Backend-Fallback");
        return new Response(backendResp.body, {
          status: backendResp.status,
          headers: fbHeaders,
        });
      }

      // Return structured JSON error instead of corrupt HTML
      return new Response(
        JSON.stringify({
          error: `Google Drive API error (${gdriveResp.status})`,
          details: errBody.substring(0, 500),
          fileId,
        }),
        {
          status: gdriveResp.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Build accelerated edge streaming response with clean RFC 6266 headers
    const cleanAscii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "");
    const utf8Encoded = encodeURIComponent(fileName);
    const disposition = isInline
      ? `inline; filename="${cleanAscii}"; filename*=UTF-8''${utf8Encoded}`
      : `attachment; filename="${cleanAscii}"; filename*=UTF-8''${utf8Encoded}`;

    const respHeaders = new Headers();
    respHeaders.set("Content-Disposition", disposition);
    respHeaders.set("Content-Type", mimeType);
    respHeaders.set("Accept-Ranges", "bytes");
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    respHeaders.set(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type"
    );
    respHeaders.set("X-Accelerated-By", "Cloudflare Workers Edge (GDI Proxy)");
    respHeaders.set("Cache-Control", "public, max-age=3600");

    if (gdriveResp.headers.has("Content-Length")) {
      respHeaders.set("Content-Length", gdriveResp.headers.get("Content-Length")!);
    } else if (meta?.size) {
      respHeaders.set("Content-Length", String(meta.size));
    }

    if (gdriveResp.headers.has("Content-Range")) {
      respHeaders.set("Content-Range", gdriveResp.headers.get("Content-Range")!);
    }

    return new Response(gdriveResp.body, {
      status: gdriveResp.status,
      statusText: gdriveResp.statusText,
      headers: respHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "Edge Download Proxy Error",
        message: err?.message || String(err),
        fileId,
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx?: unknown): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

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

    const backendBase =
      url.searchParams.get("backend") ||
      env.DEFAULT_BACKEND_URL ||
      "https://mild-leaf.nyc.boxd.sh";

    // ── Route 1: Explicit Preview SPA Routes ────────────────────────────────
    // /preview/:fileId or /preview/:fileId/:fileName or /file/... with ?view=1 or ?preview=1
    const wantsPreview =
      pathname.startsWith("/preview/") ||
      url.searchParams.has("preview") ||
      url.searchParams.has("view") ||
      url.searchParams.get("a") === "view";

    if (wantsPreview) {
      return env.ASSETS.fetch(request);
    }

    // ── Route 2: Direct File Download Route (/file/:fileId or /file/:fileId/:fileName) ──
    const fileMatch = pathname.match(/^\/file\/([^/]+)(?:\/(.*))?$/);
    if (fileMatch) {
      const fileId = fileMatch[1];
      const fileName = fileMatch[2] ? decodeURIComponent(fileMatch[2]) : null;
      const isInline = url.searchParams.get("inline") === "true";
      const exportFmt = url.searchParams.get("fmt");

      return streamGoogleDriveFile(
        fileId,
        fileName,
        isInline,
        exportFmt,
        backendBase,
        env,
        request
      );
    }

    // ── Route 3: /download.aspx or /proxy/download or /proxy/stream ─────────
    const isDownloadAspx = pathname === "/download.aspx";
    const isProxyDownload = pathname === "/proxy/download";
    const isProxyStream =
      pathname.startsWith("/proxy/stream/") || pathname.startsWith("/api/proxy/stream/");

    if (isDownloadAspx || isProxyDownload || isProxyStream) {
      let fileId = url.searchParams.get("id") || url.searchParams.get("file");
      if (!fileId && isProxyStream) {
        fileId = pathname.split("/").pop() || null;
      }

      if (!fileId) {
        return new Response(
          JSON.stringify({ error: "Missing 'id' or 'file' query parameter." }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      const explicitName = url.searchParams.get("name");
      const isInline = url.searchParams.get("inline") === "true" || isProxyStream;
      const exportFmt = url.searchParams.get("fmt");

      return streamGoogleDriveFile(
        fileId,
        explicitName,
        isInline,
        exportFmt,
        backendBase,
        env,
        request
      );
    }

    // ── Default: Serve Single Page Application (SPA) Static Assets ──────────
    return env.ASSETS.fetch(request);
  },
};
