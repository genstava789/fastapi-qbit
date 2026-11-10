import logging
import socket
import struct
import urllib.parse
from typing import Dict, Set, Tuple
from fastapi import APIRouter, Request, Response

logger = logging.getLogger("bittorrent-tracker")

tracker_router = APIRouter()

# In-memory peer registry: info_hash (hex) -> Set of (ip, port)
PEERS: Dict[str, Set[Tuple[str, int]]] = {}

# Our dedicated public seeder endpoint
PUBLIC_SEEDER_IP = "185.209.179.23"
PUBLIC_SEEDER_PORT = 55618


@tracker_router.get("/announce", include_in_schema=False)
async def tracker_announce(request: Request):
    """
    Lightweight BitTorrent HTTP Tracker conforming to BEP 3.
    Always includes this server's public peer endpoint so external clients
    can connect and download immediately without NAT/IP mismatches.
    """
    raw_query = request.scope.get("query_string", b"").decode("latin-1")

    params = {}
    for part in raw_query.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            params[k] = v

    info_hash_raw = params.get("info_hash", "")
    info_hash_bytes = urllib.parse.unquote_to_bytes(info_hash_raw)
    info_hash_hex = info_hash_bytes.hex()

    client_port = int(params.get("port", 0)) if params.get("port", "").isdigit() else 0
    client_ip = request.client.host if request.client else "127.0.0.1"

    if info_hash_hex not in PEERS:
        PEERS[info_hash_hex] = set()

    # Always ensure our public seeder is registered in this swarm
    PEERS[info_hash_hex].add((PUBLIC_SEEDER_IP, PUBLIC_SEEDER_PORT))

    if client_ip not in ("127.0.0.1", "::1", "10.122.170.184") and client_port > 0:
        PEERS[info_hash_hex].add((client_ip, client_port))

    compact = params.get("compact", "1") != "0"

    # Don't send client back their own endpoint if multiple peers exist
    peers_to_send = [
        p for p in PEERS[info_hash_hex]
        if not (p[0] == client_ip and p[1] == client_port)
    ]
    if not peers_to_send:
        peers_to_send = [(PUBLIC_SEEDER_IP, PUBLIC_SEEDER_PORT)]

    if compact:
        peer_bytes = b""
        for ip, port in peers_to_send:
            try:
                peer_bytes += socket.inet_aton(ip) + struct.pack(">H", port)
            except Exception:
                pass
        bencoded = (
            b"d"
            b"8:completei1e"
            b"10:incompletei0e"
            b"8:intervali60e"
            b"12:min intervali30e"
            b"5:peers" + str(len(peer_bytes)).encode() + b":" + peer_bytes +
            b"e"
        )
    else:
        peer_list = b"l"
        for ip, port in peers_to_send:
            peer_list += (
                b"d"
                b"2:ip" + str(len(ip)).encode() + b":" + ip.encode() +
                b"4:porti" + str(port).encode() + b"e"
                b"e"
            )
        peer_list += b"e"
        bencoded = (
            b"d"
            b"8:completei1e"
            b"10:incompletei0e"
            b"8:intervali60e"
            b"12:min intervali30e"
            b"5:peers" + peer_list +
            b"e"
        )

    return Response(
        content=bencoded,
        media_type="text/plain",
    )
