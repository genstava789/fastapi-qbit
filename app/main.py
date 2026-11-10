from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from app.api import api_router_v1, proxy_router, tracker_router
from app.core.config import settings
from app.services.qbit_service import qbit_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("fastapi-qbit")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: check qBittorrent connection
    logger.info("Initializing FastAPI qBittorrent API...")
    connected, version = qbit_service.check_connection()
    if connected:
        logger.info(f"Connected to qBittorrent daemon successfully (Version: {version})")
    else:
        logger.warning(
            f"Could not connect to qBittorrent at {settings.qbit_base_url}. Make sure daemon is running."
        )
    yield
    # Shutdown
    logger.info("Shutting down FastAPI qBittorrent API...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="RESTful API for qBittorrent management, built with FastAPI and qbittorrent-api.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount WebTorrent reverse proxy router
app.include_router(proxy_router)

# Mount BitTorrent tracker
app.include_router(tracker_router)

# Mount API routes
app.include_router(api_router_v1, prefix=settings.API_V1_STR)


@app.get("/", response_class=HTMLResponse, tags=["Root"])
def root_dashboard():
    connected, qbit_ver = qbit_service.check_connection()
    status_color = "#10b981" if connected else "#ef4444"
    status_text = f"Connected (qBittorrent {qbit_ver})" if connected else "Disconnected (Check qBittorrent)"

    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{settings.PROJECT_NAME}</title>
        <style>
            * {{ box-sizing: border-box; margin: 0; padding: 0; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: #0b0f19;
                color: #e2e8f0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
            }}
            .container {{
                background: #151d30;
                border: 1px solid #1e293b;
                border-radius: 16px;
                padding: 36px;
                max-width: 680px;
                width: 100%;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            }}
            .header {{
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 24px;
                border-bottom: 1px solid #1e293b;
                padding-bottom: 20px;
            }}
            h1 {{
                font-size: 1.8rem;
                background: linear-gradient(90deg, #38bdf8, #818cf8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            .badge {{
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: rgba(15, 23, 42, 0.8);
                padding: 6px 14px;
                border-radius: 9999px;
                font-size: 0.85rem;
                font-weight: 500;
                border: 1px solid #334155;
            }}
            .dot {{
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: {status_color};
                box-shadow: 0 0 10px {status_color};
            }}
            p.desc {{
                color: #94a3b8;
                font-size: 1rem;
                margin-bottom: 24px;
                line-height: 1.6;
            }}
            .quick-actions {{
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
                margin-bottom: 28px;
            }}
            .btn {{
                display: block;
                text-align: center;
                padding: 12px 18px;
                background: #1e293b;
                color: #f8fafc;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 500;
                border: 1px solid #334155;
                transition: all 0.2s ease;
            }}
            .btn:hover {{
                background: #2563eb;
                border-color: #3b82f6;
                transform: translateY(-2px);
            }}
            .curl-box {{
                background: #090d16;
                border: 1px solid #1e293b;
                border-radius: 10px;
                padding: 18px;
            }}
            .curl-header {{
                font-size: 0.85rem;
                color: #64748b;
                margin-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                font-weight: 600;
            }}
            pre {{
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 0.85rem;
                color: #38bdf8;
                overflow-x: auto;
                white-space: pre-wrap;
                word-break: break-all;
                line-height: 1.5;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>fastapi-qbit</h1>
                <div class="badge">
                    <span class="dot"></span>
                    <span>{status_text}</span>
                </div>
            </div>
            <p class="desc">
                API qBittorrent siap digunakan. Anda dapat menambahkan tautan magnet melalui curl atau antarmuka dokumentasi Swagger UI.
            </p>
            <div class="quick-actions" style="grid-template-columns: 1fr 1fr 1fr;">
                <a class="btn" href="/webtorrent/" target="_blank" style="background: #1e3a8a; border-color: #3b82f6;">qBittorrent Web UI</a>
                <a class="btn" href="/docs" target="_blank">Swagger Docs</a>
                <a class="btn" href="/redoc" target="_blank">ReDoc</a>
            </div>
            <div class="curl-box">
                <div class="curl-header">Contoh Menambahkan Magnet Link via cURL:</div>
                <pre>curl -X POST "http://localhost:{settings.SERVER_PORT}{settings.API_V1_STR}/torrents/add-magnet" \\
     -H "Content-Type: application/json" \\
     -d '{{"magnet_url": "magnet:?xt=urn:btih:..."}}'</pre>
            </div>
        </div>
    </body>
    </html>
    """

