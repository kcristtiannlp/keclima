#!/usr/bin/env python3
"""
KeClima static server + proxies (FIRMS + INPE Queimadas + INMET + OpenSky voos).

Uso:
  python3 serve.py
  python3 serve.py 8080
  PORT=10000 python3 serve.py   # PaaS (Render/Railway/Fly)
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_VERSION = "0.6.0"


def resolve_port() -> int:
    """Porta: argv[1] > env PORT (PaaS) > 8080."""
    if len(sys.argv) > 1:
        return int(sys.argv[1])
    env = os.environ.get("PORT")
    if env:
        return int(env)
    return 8080


PORT = resolve_port()

BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

FIRMS_PUBLIC = {
    "south_america": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_24h.csv",
    "central_america": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Central_America_24h.csv",
    "usa_canada": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
    "europe": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv",
    "africa": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Africa_24h.csv",
    "asia": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_24h.csv",
    "australia": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Australia_NewZealand_24h.csv",
    "world_modis": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv",
}

INPE_CSV_BASE = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv"
INPE_DAILY_BR = INPE_CSV_BASE + "/diario/Brasil/focos_diario_br_{date}.csv"
INPE_10MIN_DIR = INPE_CSV_BASE + "/10min/"

# cache em memória
_CACHE: dict[str, tuple[float, object]] = {}


def cache_get(key: str, ttl: float):
    item = _CACHE.get(key)
    if not item:
        return None
    ts, val = item
    if time.time() - ts > ttl:
        return None
    return val


def cache_set(key: str, val):
    _CACHE[key] = (time.time(), val)


def fetch_url(url: str, timeout: int = 45, accept: str = "*/*", extra_headers: dict | None = None) -> tuple[int, bytes]:
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": accept,
        "Referer": "https://tempo.inmet.gov.br/",
        "Origin": "https://tempo.inmet.gov.br",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        body = exc.read() if hasattr(exc, "read") else b""
        return exc.code, body


def pick_region(lat: float, lon: float) -> str:
    if -60 <= lat <= 15 and -90 <= lon <= -30:
        return "south_america"
    if 5 <= lat <= 35 and -120 <= lon <= -60:
        return "central_america"
    if 24 <= lat <= 72 and -170 <= lon <= -50:
        return "usa_canada"
    if 34 <= lat <= 72 and -25 <= lon <= 45:
        return "europe"
    if -35 <= lat <= 38 and -20 <= lon <= 55:
        return "africa"
    if -15 <= lat <= 40 and 60 <= lon <= 150:
        return "asia"
    if -50 <= lat <= 0 and 100 <= lon <= 180:
        return "australia"
    return "world_modis"


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def load_inmet_stations():
    cached = cache_get("inmet_stations", 6 * 3600)
    if cached is not None:
        return cached
    status, raw = fetch_url(
        "https://apitempo.inmet.gov.br/estacoes/T",
        timeout=40,
        accept="application/json,text/plain,*/*",
    )
    if status != 200 or not raw:
        raise RuntimeError(f"stations_http_{status}")
    data = json.loads(raw.decode("utf-8", errors="replace"))
    stations = []
    for s in data:
        try:
            lat = float(s.get("VL_LATITUDE"))
            lon = float(s.get("VL_LONGITUDE"))
        except (TypeError, ValueError):
            continue
        stations.append(
            {
                "code": s.get("CD_ESTACAO"),
                "name": s.get("DC_NOME"),
                "state": s.get("SG_ESTADO"),
                "status": s.get("CD_SITUACAO"),
                "latitude": lat,
                "longitude": lon,
                "altitude": _num(s.get("VL_ALTITUDE")),
                "entity": s.get("SG_ENTIDADE"),
            }
        )
    cache_set("inmet_stations", stations)
    return stations


def fetch_inmet_obs(code: str):
    """Tenta horários recentes; devolve última leitura válida se a API responder."""
    cache_key = f"inmet_obs:{code}"
    cached = cache_get(cache_key, 10 * 60)
    if cached is not None:
        return cached

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=2)
    # formatos comuns da API pública
    ranges = [
        (start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")),
        ((end - timedelta(days=1)).strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")),
    ]
    for a, b in ranges:
        url = f"https://apitempo.inmet.gov.br/estacao/{a}/{b}/{code}"
        status, raw = fetch_url(url, timeout=30, accept="application/json,text/plain,*/*")
        if status == 200 and raw:
            try:
                rows = json.loads(raw.decode("utf-8", errors="replace"))
            except json.JSONDecodeError:
                continue
            if isinstance(rows, list) and rows:
                obs = normalize_inmet_row(rows[-1], code)
                if obs:
                    cache_set(cache_key, obs)
                    return obs
    # API sem conteúdo (204) ou vazia
    empty = {"available": False, "code": code}
    cache_set(cache_key, empty)
    return empty


def normalize_inmet_row(row: dict, code: str):
    def g(*keys):
        for k in keys:
            if k in row and row[k] not in (None, "", "null"):
                return row[k]
        return None

    temp = _num(g("TEM_INS", "TEMP_INS", "TEM_MAX"))
    # se tudo nulo, ignora
    hum = _num(g("UMD_INS", "UMI_INS", "UMID_INS"))
    wind = _num(g("VEN_VEL", "VEN_VET", "VENTO_VEL"))
    wind_dir = _num(g("VEN_DIR", "VENTO_DIR"))
    pressure = _num(g("PRE_INS", "PRESSAO", "PRE_MAX"))
    rain = _num(g("CHUVA", "PRECIPITACAO", "CHUVA_HORARIA"))
    date = g("DT_MEDICAO", "DT_MED", "DATA")
    hour = g("HR_MEDICAO", "HR_MED", "HORA")

    if all(v is None for v in (temp, hum, wind, pressure, rain)):
        return None

    return {
        "available": True,
        "code": code,
        "temperature": temp,
        "humidity": hum,
        "windSpeedMs": wind,  # m/s na maioria das estações automáticas
        "windDirection": wind_dir,
        "pressure": pressure,
        "precipitation": rain,
        "date": date,
        "hour": hour,
        "rawTime": f"{date or ''} {hour or ''}".strip(),
    }


def _num(v):
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_firms_csv(text: str, west: float, south: float, east: float, north: float):
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    header = [h.strip().lower() for h in lines[0].split(",")]
    try:
        i_lat = header.index("latitude")
        i_lon = header.index("longitude")
    except ValueError:
        return []

    def col(*names):
        for n in names:
            if n in header:
                return header.index(n)
        return None

    i_date, i_time = col("acq_date"), col("acq_time")
    i_conf, i_sat = col("confidence"), col("satellite")
    i_frp, i_bright = col("frp"), col("brightness", "bright_ti4")
    i_daynight = col("daynight")
    out = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) <= max(i_lat, i_lon):
            continue
        try:
            lat = float(parts[i_lat])
            lon = float(parts[i_lon])
        except ValueError:
            continue
        if not (south <= lat <= north and west <= lon <= east):
            continue
        out.append(
            {
                "latitude": lat,
                "longitude": lon,
                "date": parts[i_date] if i_date is not None and i_date < len(parts) else None,
                "time": parts[i_time] if i_time is not None and i_time < len(parts) else None,
                "confidence": parts[i_conf] if i_conf is not None and i_conf < len(parts) else None,
                "satellite": parts[i_sat] if i_sat is not None and i_sat < len(parts) else None,
                "frp": _num(parts[i_frp]) if i_frp is not None and i_frp < len(parts) else None,
                "brightness": _num(parts[i_bright]) if i_bright is not None and i_bright < len(parts) else None,
                "daynight": parts[i_daynight] if i_daynight is not None and i_daynight < len(parts) else None,
            }
        )
    return out



def fetch_inpe_daily_brazil(days_back: int = 1):
    """Baixa CSV diário Brasil do INPE (hoje e dias anteriores)."""
    points = []
    now = datetime.now(timezone.utc)
    for d in range(days_back + 1):
        day = now - timedelta(days=d)
        stamp = day.strftime("%Y%m%d")
        url = INPE_DAILY_BR.format(date=stamp)
        cache_key = f"inpe_daily:{stamp}"
        cached = cache_get(cache_key, 20 * 60)
        if cached is not None:
            points.extend(cached)
            continue
        status, raw = fetch_url(url, timeout=40, accept="text/csv,text/plain,*/*")
        if status != 200 or not raw:
            continue
        text_csv = raw.decode("utf-8", errors="replace")
        if text_csv.lstrip().startswith("<"):
            continue
        day_points = parse_inpe_csv(text_csv, source_kind="inpe_daily")
        cache_set(cache_key, day_points)
        points.extend(day_points)
    return points


def fetch_inpe_10min_latest(max_files: int = 6):
    """Últimos arquivos de 10 min (quase tempo real)."""
    cache_key = "inpe_10min_list"
    listing = cache_get(cache_key, 5 * 60)
    if listing is None:
        status, raw = fetch_url(INPE_10MIN_DIR, timeout=25, accept="text/html,text/plain,*/*")
        if status != 200 or not raw:
            return []
        html = raw.decode("utf-8", errors="replace")
        import re
        files = sorted(set(re.findall(r"focos_10min_\d{8}_\d{4}\.csv", html)))
        listing = files[-max_files:] if files else []
        cache_set(cache_key, listing)
    points = []
    for name in listing:
        ck = f"inpe_10min:{name}"
        cached = cache_get(ck, 8 * 60)
        if cached is not None:
            points.extend(cached)
            continue
        status, raw = fetch_url(INPE_10MIN_DIR + name, timeout=25, accept="text/csv,text/plain,*/*")
        if status != 200 or not raw:
            continue
        text_csv = raw.decode("utf-8", errors="replace")
        if text_csv.lstrip().startswith("<"):
            continue
        pts = parse_inpe_csv(text_csv, source_kind="inpe_10min")
        cache_set(ck, pts)
        points.extend(pts)
    return points


def parse_inpe_csv(text_csv: str, source_kind: str = "inpe"):
    lines = [ln.strip() for ln in text_csv.splitlines() if ln.strip()]
    if not lines:
        return []
    header = [h.strip().lower() for h in lines[0].split(",")]
    # normaliza nomes
    def idx(*names):
        for n in names:
            if n in header:
                return header.index(n)
        return None

    i_lat = idx("lat", "latitude")
    i_lon = idx("lon", "longitude", "long")
    if i_lat is None or i_lon is None:
        return []
    i_sat = idx("satelite", "satellite")
    i_dt = idx("data_hora_gmt", "data", "datahora", "acq_date")
    i_mun = idx("municipio")
    i_uf = idx("estado")
    i_bioma = idx("bioma")
    i_frp = idx("frp")
    i_risco = idx("risco_fogo")

    out = []
    for line in lines[1:]:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) <= max(i_lat, i_lon):
            continue
        try:
            lat = float(parts[i_lat])
            lon = float(parts[i_lon])
        except ValueError:
            continue
        dt = parts[i_dt] if i_dt is not None and i_dt < len(parts) else None
        date, time_part = None, None
        if dt:
            # "2026-07-11 00:00:00" ou só data
            bits = dt.replace("T", " ").split()
            date = bits[0] if bits else None
            time_part = bits[1] if len(bits) > 1 else None
        out.append(
            {
                "latitude": lat,
                "longitude": lon,
                "date": date,
                "time": time_part,
                "satellite": parts[i_sat] if i_sat is not None and i_sat < len(parts) else None,
                "confidence": None,
                "frp": _num(parts[i_frp]) if i_frp is not None and i_frp < len(parts) else None,
                "brightness": None,
                "daynight": None,
                "municipio": parts[i_mun] if i_mun is not None and i_mun < len(parts) else None,
                "estado": parts[i_uf] if i_uf is not None and i_uf < len(parts) else None,
                "bioma": parts[i_bioma] if i_bioma is not None and i_bioma < len(parts) else None,
                "risco_fogo": _num(parts[i_risco]) if i_risco is not None and i_risco < len(parts) else None,
                "sources": [source_kind if source_kind.startswith("inpe") else "inpe"],
                "provider": "inpe",
            }
        )
    return out


def filter_bbox(points, west, south, east, north):
    return [
        p
        for p in points
        if south <= p["latitude"] <= north and west <= p["longitude"] <= east
    ]


def fetch_firms_points(west, south, east, north, lat, lon, key, days):
    """Retorna lista no formato unificado (provider firms)."""
    if key:
        source = "VIIRS_SNPP_NRT"
        area = f"{west},{south},{east},{north}"
        url = (
            f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
            f"{urllib.parse.quote(key)}/{source}/{area}/{days}"
        )
        status, raw = fetch_url(url, accept="text/csv,text/plain,*/*")
        text_csv = raw.decode("utf-8", errors="replace")
        if status >= 400 or text_csv.lower().startswith("invalid") or "error" in text_csv[:80].lower():
            raise RuntimeError("firms_key_or_quota")
        pts = parse_firms_csv(text_csv, west, south, east, north)
        label = "firms_area_api"
    else:
        region = pick_region(lat, lon)
        url = FIRMS_PUBLIC.get(region) or FIRMS_PUBLIC["south_america"]
        status, raw = fetch_url(url, accept="text/csv,text/plain,*/*")
        if status != 200:
            raise RuntimeError(f"firms_http_{status}")
        text_csv = raw.decode("utf-8", errors="replace")
        pts = parse_firms_csv(text_csv, west, south, east, north)
        label = f"firms_public_{region}"
    for p in pts:
        p["provider"] = "firms"
        p["sources"] = ["firms"]
        p.setdefault("municipio", None)
        p.setdefault("estado", None)
        p.setdefault("bioma", None)
        p.setdefault("risco_fogo", None)
    return pts, label


def merge_fire_points(inpe_pts, firms_pts, cell=0.02):
    """
    Une focos INPE + FIRMS.
    Célula ~0.02° (~2 km): se coincidem, marca sources=['inpe','firms'] (mais confiança).
    """
    buckets = {}

    def key_of(p):
        return (round(p["latitude"] / cell), round(p["longitude"] / cell))

    def add(p):
        k = key_of(p)
        if k not in buckets:
            buckets[k] = dict(p)
            buckets[k]["sources"] = list(p.get("sources") or [p.get("provider") or "unknown"])
            return
        cur = buckets[k]
        # merge sources
        src = set(cur.get("sources") or [])
        src.update(p.get("sources") or [])
        cur["sources"] = sorted(src)
        # prefere metadados INPE (municipio/estado/bioma)
        if p.get("provider") == "inpe" or "inpe" in (p.get("sources") or []):
            for field in ("municipio", "estado", "bioma", "risco_fogo", "satellite", "frp", "date", "time"):
                if p.get(field) not in (None, ""):
                    cur[field] = p[field]
            # se só FIRMS tinha frp e INPE não, mantém
        else:
            if cur.get("frp") is None and p.get("frp") is not None:
                cur["frp"] = p["frp"]
            if cur.get("confidence") is None and p.get("confidence") is not None:
                cur["confidence"] = p["confidence"]
            if cur.get("satellite") is None and p.get("satellite") is not None:
                cur["satellite"] = p["satellite"]
        # média leve das coords se ambos
        if len(cur["sources"]) > 1:
            cur["latitude"] = (cur["latitude"] + p["latitude"]) / 2
            cur["longitude"] = (cur["longitude"] + p["longitude"]) / 2
        # provider label
        if set(cur["sources"]) >= {"inpe", "firms"} or (
            any(s.startswith("inpe") for s in cur["sources"]) and "firms" in cur["sources"]
        ):
            cur["provider"] = "both"
        elif any(s.startswith("inpe") for s in cur["sources"]):
            cur["provider"] = "inpe"
        else:
            cur["provider"] = "firms"

    for p in inpe_pts:
        add(p)
    for p in firms_pts:
        add(p)

    # normaliza sources tags
    out = []
    for p in buckets.values():
        src = []
        for s in p.get("sources") or []:
            if s.startswith("inpe"):
                if "inpe" not in src:
                    src.append("inpe")
            elif s == "firms":
                if "firms" not in src:
                    src.append("firms")
            else:
                if s not in src:
                    src.append(s)
        p["sources"] = src
        if set(src) == {"inpe", "firms"}:
            p["provider"] = "both"
        out.append(p)
    return out



# --- Desmatamento INPE DETER (TerraBrasilis WFS) ---
DETER_LAYERS = [
    ("deter-amz:deter_amz", "Amazônia"),
    ("deter-cerrado-nb:deter_cerrado", "Cerrado"),
]
WFS_BASE = "https://terrabrasilis.dpi.inpe.br/geoserver/ows"


def geom_centroid(geom):
    if not geom:
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    try:
        if gtype == "Point":
            return float(coords[0]), float(coords[1])
        if gtype == "Polygon":
            ring = coords[0]
        elif gtype == "MultiPolygon":
            ring = coords[0][0]
        else:
            return None
        xs = [float(c[0]) for c in ring]
        ys = [float(c[1]) for c in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    except (TypeError, ValueError, ZeroDivisionError, IndexError):
        return None


def fetch_deter_bbox(west, south, east, north, max_features=120):
    """Consulta WFS DETER Amazônia + Cerrado no bbox."""
    import urllib.parse as up

    all_features = []
    errors = []
    for type_name, biome in DETER_LAYERS:
        # bbox order: minx,miny,maxx,maxy in EPSG:4326
        bbox = f"{west},{south},{east},{north},EPSG:4326"
        params = {
            "service": "WFS",
            "version": "1.0.0",
            "request": "GetFeature",
            "typeName": type_name,
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
            "bbox": bbox,
            "maxFeatures": str(max_features),
        }
        url = WFS_BASE + "?" + up.urlencode(params)
        cache_key = f"deter:{type_name}:{west:.2f},{south:.2f},{east:.2f},{north:.2f}"
        cached = cache_get(cache_key, 30 * 60)
        if cached is not None:
            all_features.extend(cached)
            continue
        try:
            status, raw = fetch_url(url, timeout=40, accept="application/json,application/geo+json,*/*")
            if status != 200 or not raw:
                errors.append(f"{type_name}:http_{status}")
                continue
            data = json.loads(raw.decode("utf-8", errors="replace"))
            feats = data.get("features") or []
            simplified = []
            for f in feats:
                props = f.get("properties") or {}
                geom = f.get("geometry")
                cen = geom_centroid(geom)
                if not cen:
                    continue
                lon, lat = cen
                classname = props.get("classname") or props.get("class_name") or "ALERTA"
                simplified.append(
                    {
                        "id": props.get("gid") or f"{type_name}:{lon:.4f},{lat:.4f}",
                        "latitude": lat,
                        "longitude": lon,
                        "classname": classname,
                        "viewDate": props.get("view_date") or props.get("viewDate"),
                        "createdDate": props.get("created_date"),
                        "municipality": props.get("municipality") or props.get("municipio"),
                        "uf": props.get("uf"),
                        "areaKm2": _num(props.get("areamunkm") or props.get("areatotalkm") or props.get("areauckm")),
                        "satellite": props.get("satellite"),
                        "sensor": props.get("sensor"),
                        "biome": biome,
                        "layer": type_name,
                        "geometry": geom,
                    }
                )
            cache_set(cache_key, simplified)
            all_features.extend(simplified)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{type_name}:{exc}")
    return all_features, errors


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(
                {
                    "ok": True,
                    "service": "keclima",
                    "version": APP_VERSION,
                    "firms_proxy": True,
                    "inmet_proxy": True,
                    "inpe_proxy": True,
                    "fires_merged": True,
                    "deforestation_proxy": True,
                    "flights_proxy": True,
                }
            )
            return
        if parsed.path == "/api/firms/hotspots":
            self.handle_firms(parsed)
            return
        if parsed.path == "/api/fires/hotspots":
            self.handle_fires_merged(parsed)
            return
        if parsed.path == "/api/deforestation/alerts":
            self.handle_deforestation(parsed)
            return
        if parsed.path == "/api/inmet/nearest":
            self.handle_inmet_nearest(parsed)
            return
        if parsed.path == "/api/flights/live":
            self.handle_flights_live(parsed)
            return
        if parsed.path == "/api/flights/aircraft":
            self.handle_flights_aircraft(parsed)
            return
        if parsed.path == "/api/flights/route":
            self.handle_flights_route(parsed)
            return
        return super().do_GET()

    def handle_inmet_nearest(self, parsed: urllib.parse.ParseResult):
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            lat = float(qs.get("lat", ["-23.55"])[0])
            lon = float(qs.get("lon", ["-46.63"])[0])
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return

        # fora do BR-ish: sem estação
        if not (-35 <= lat <= 6 and -75 <= lon <= -30):
            self.send_json(
                {
                    "inBrazil": False,
                    "station": None,
                    "observation": None,
                    "links": official_links(None, lat, lon),
                    "message": "outside_brazil",
                }
            )
            return

        try:
            stations = load_inmet_stations()
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": "stations_failed", "detail": str(exc)}, 502)
            return

        oper = [
            s
            for s in stations
            if s.get("code")
            and str(s.get("status") or "").lower().startswith("oper")
        ]
        pool = oper or [s for s in stations if s.get("code")]
        if not pool:
            self.send_json({"error": "no_stations"}, 502)
            return

        best = min(pool, key=lambda s: haversine_km(lat, lon, s["latitude"], s["longitude"]))
        dist = round(haversine_km(lat, lon, best["latitude"], best["longitude"]), 1)

        obs = None
        try:
            obs = fetch_inmet_obs(best["code"])
        except Exception as exc:  # noqa: BLE001
            obs = {"available": False, "error": str(exc)}

        # converter vento m/s -> km/h para o app
        if obs and obs.get("available") and obs.get("windSpeedMs") is not None:
            obs["windSpeedKmh"] = round(obs["windSpeedMs"] * 3.6, 1)

        self.send_json(
            {
                "inBrazil": True,
                "station": {**best, "distanceKm": dist},
                "observation": obs,
                "links": official_links(best, lat, lon),
                "disclaimer": "INMET observado · pode diferir da previsão por modelo",
                "fetchedAt": int(time.time() * 1000),
            }
        )



    def handle_deforestation(self, parsed: urllib.parse.ParseResult):
        """Alertas DETER (INPE/TerraBrasilis) no bbox + resumo."""
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            west = float(qs.get("west", ["-75"])[0])
            south = float(qs.get("south", ["-35"])[0])
            east = float(qs.get("east", ["-30"])[0])
            north = float(qs.get("north", ["6"])[0])
            lat = float(qs.get("lat", [str((south + north) / 2)])[0])
            lon = float(qs.get("lon", [str((west + east) / 2)])[0])
            # limita bbox enorme (evita travar)
            if abs(east - west) > 8 or abs(north - south) > 8:
                half = 2.5
                west, east = lon - half, lon + half
                south, north = lat - half, lat + half
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return

        if not (-35 <= lat <= 6 and -75 <= lon <= -30):
            self.send_json(
                {
                    "inBrazil": False,
                    "count": 0,
                    "alerts": [],
                    "links": {
                        "terrabrasilis": "https://terrabrasilis.dpi.inpe.br/",
                        "deter": "https://terrabrasilis.dpi.inpe.br/app/dashboard/alerts/legal/amazon/daily/",
                        "prodes": "https://terrabrasilis.dpi.inpe.br/app/dashboard/deforestation/biomes/legal/amazon/increments",
                    },
                    "message": "outside_brazil",
                }
            )
            return

        try:
            alerts, errors = fetch_deter_bbox(west, south, east, north)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": "deter_failed", "detail": str(exc)}, 502)
            return

        # ordena por data mais recente
        def sort_key(a):
            return a.get("viewDate") or a.get("createdDate") or ""

        alerts.sort(key=sort_key, reverse=True)

        # distância ao ponto de interesse
        for a in alerts:
            a["distanceKm"] = round(
                haversine_km(lat, lon, a["latitude"], a["longitude"]), 1
            )
        alerts.sort(key=lambda a: a.get("distanceKm") if a.get("distanceKm") is not None else 9999)

        nearest = alerts[0] if alerts else None
        area_sum = sum((a.get("areaKm2") or 0) for a in alerts)

        self.send_json(
            {
                "inBrazil": True,
                "count": len(alerts),
                "areaKm2": round(area_sum, 3),
                "nearest": nearest,
                "alerts": alerts[:150],
                "errors": errors,
                "source": "INPE DETER (TerraBrasilis WFS)",
                "disclaimer": "DETER = alerta de mudança de cobertura. Não substitui fiscalização em campo.",
                "links": {
                    "terrabrasilis": "https://terrabrasilis.dpi.inpe.br/",
                    "deterAmazon": "https://terrabrasilis.dpi.inpe.br/app/dashboard/alerts/legal/amazon/daily/",
                    "deterCerrado": "https://terrabrasilis.dpi.inpe.br/app/dashboard/alerts/biomes/cerrado/daily/",
                    "prodes": "https://terrabrasilis.dpi.inpe.br/app/map/deforestation/",
                    "downloads": "https://terrabrasilis.dpi.inpe.br/downloads/",
                },
                "fetchedAt": int(time.time() * 1000),
            }
        )

    def handle_fires_merged(self, parsed: urllib.parse.ParseResult):
        """INPE Queimadas + NASA FIRMS fundidos (mais cobertura e cruzamento)."""
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            west = float(qs.get("west", ["-180"])[0])
            south = float(qs.get("south", ["-90"])[0])
            east = float(qs.get("east", ["180"])[0])
            north = float(qs.get("north", ["90"])[0])
            days = max(1, min(5, int(qs.get("days", ["1"])[0])))
            key = (qs.get("key", [""])[0] or "").strip()
            lat = float(qs.get("lat", [str((south + north) / 2)])[0])
            lon = float(qs.get("lon", [str((west + east) / 2)])[0])
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return

        inpe_pts = []
        firms_pts = []
        inpe_err = None
        firms_err = None
        firms_label = None

        # INPE: diário BR (1-2 dias) + quase tempo real 10 min
        try:
            inpe_all = fetch_inpe_daily_brazil(days_back=1)
            inpe_all.extend(fetch_inpe_10min_latest(6))
            inpe_pts = filter_bbox(inpe_all, west, south, east, north)
        except Exception as exc:  # noqa: BLE001
            inpe_err = str(exc)

        try:
            firms_pts, firms_label = fetch_firms_points(west, south, east, north, lat, lon, key, days)
        except Exception as exc:  # noqa: BLE001
            firms_err = str(exc)
            if str(exc) == "firms_key_or_quota":
                self.send_json({"error": "firms_key_or_quota"}, 502)
                return

        if not inpe_pts and not firms_pts:
            self.send_json(
                {
                    "error": "no_fire_data",
                    "detail": {"inpe": inpe_err, "firms": firms_err},
                },
                502,
            )
            return

        merged = merge_fire_points(inpe_pts, firms_pts)
        # limita pontos no viewport
        merged = merged[:2000]
        both = sum(1 for p in merged if p.get("provider") == "both")
        self.send_json(
            {
                "source": "inpe+firms",
                "count": len(merged),
                "count_inpe": len(inpe_pts),
                "count_firms": len(firms_pts),
                "count_both": both,
                "firms_source": firms_label,
                "inpe_error": inpe_err,
                "firms_error": firms_err,
                "points": merged,
                "note": "INPE Queimadas + NASA FIRMS; pontos sobrepostos marcam ambas as fontes",
            }
        )

    def handle_firms(self, parsed: urllib.parse.ParseResult):
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            west = float(qs.get("west", ["-180"])[0])
            south = float(qs.get("south", ["-90"])[0])
            east = float(qs.get("east", ["180"])[0])
            north = float(qs.get("north", ["90"])[0])
            days = max(1, min(5, int(qs.get("days", ["1"])[0])))
            key = (qs.get("key", [""])[0] or "").strip()
            lat = float(qs.get("lat", [str((south + north) / 2)])[0])
            lon = float(qs.get("lon", [str((west + east) / 2)])[0])
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return

        try:
            if key:
                source = qs.get("source", ["VIIRS_SNPP_NRT"])[0]
                area = f"{west},{south},{east},{north}"
                url = (
                    f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
                    f"{urllib.parse.quote(key)}/{source}/{area}/{days}"
                )
                status, raw = fetch_url(url, accept="text/csv,text/plain,*/*")
                text = raw.decode("utf-8", errors="replace")
                if status >= 400 or text.lower().startswith("invalid") or "error" in text[:80].lower():
                    self.send_json({"error": "firms_key_or_quota", "detail": text[:200]}, 502)
                    return
                points = parse_firms_csv(text, west, south, east, north)
                self.send_json({"source": "firms_area_api", "count": len(points), "points": points[:1500]})
                return

            region = qs.get("region", [pick_region(lat, lon)])[0]
            url = FIRMS_PUBLIC.get(region) or FIRMS_PUBLIC["south_america"]
            status, raw = fetch_url(url, accept="text/csv,text/plain,*/*")
            if status != 200:
                self.send_json({"error": "upstream_http", "status": status}, 502)
                return
            text = raw.decode("utf-8", errors="replace")
            points = parse_firms_csv(text, west, south, east, north)
            self.send_json(
                {
                    "source": f"firms_public_{region}",
                    "count": len(points),
                    "points": points[:1500],
                    "note": "public_csv_24h_no_key",
                }
            )
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": "proxy_failed", "detail": str(exc)}, 502)

    def handle_flights_aircraft(self, parsed: urllib.parse.ParseResult):
        """Tipo / matrícula / operador por ICAO24 (hexdb + adsbdb)."""
        qs = urllib.parse.parse_qs(parsed.query)
        raw = (qs.get("icao24", [""])[0] or "").strip().lower()
        hex_id = "".join(c for c in raw if c in "0123456789abcdef")
        if len(hex_id) < 6:
            self.send_json({"error": "invalid_icao24"}, 400)
            return
        hex_id = hex_id[:6]
        cache_key = f"acmeta:{hex_id}"
        cached = cache_get(cache_key, 86400.0)
        if cached is not None:
            self.send_json(cached)
            return

        aircraft = None
        # 1) hexdb
        try:
            st, body = fetch_url(
                f"https://hexdb.io/api/v1/aircraft/{hex_id}",
                timeout=10,
                accept="application/json",
                extra_headers={
                    "User-Agent": "KeClima/0.4 (weather-pwa)",
                    "Referer": "https://hexdb.io/",
                },
            )
            if st == 200:
                j = json.loads(body.decode("utf-8", errors="replace"))
                if j.get("ModeS") or j.get("Registration"):
                    aircraft = {
                        "icao24": hex_id,
                        "registration": j.get("Registration"),
                        "type": j.get("Type"),
                        "icaoType": j.get("ICAOTypeCode"),
                        "manufacturer": j.get("Manufacturer"),
                        "operator": j.get("RegisteredOwners"),
                        "operatorIcao": j.get("OperatorFlagCode"),
                        "photo": None,
                        "source": "hexdb",
                    }
        except Exception:  # noqa: BLE001
            pass

        # 2) adsbdb — completa campos em falta (foto, etc.)
        try:
            st, body = fetch_url(
                f"https://api.adsbdb.com/v0/aircraft/{hex_id}",
                timeout=10,
                accept="application/json",
                extra_headers={"User-Agent": "KeClima/0.4 (weather-pwa)"},
            )
            if st == 200:
                j = json.loads(body.decode("utf-8", errors="replace"))
                ac = (j.get("response") or {}).get("aircraft") or {}
                if ac:
                    base = aircraft or {}
                    aircraft = {
                        "icao24": hex_id,
                        "registration": base.get("registration") or ac.get("registration"),
                        "type": base.get("type") or ac.get("type"),
                        "icaoType": base.get("icaoType") or ac.get("icao_type"),
                        "manufacturer": base.get("manufacturer") or ac.get("manufacturer"),
                        "operator": base.get("operator") or ac.get("registered_owner"),
                        "operatorIcao": base.get("operatorIcao")
                        or ac.get("registered_owner_operator_flag_code"),
                        "photo": base.get("photo")
                        or ac.get("url_photo_thumbnail")
                        or ac.get("url_photo"),
                        "source": "hexdb+adsbdb" if base else "adsbdb",
                    }
        except Exception:  # noqa: BLE001
            pass

        if not aircraft:
            payload = {"aircraft": None, "error": "not_found"}
            cache_set(cache_key, payload)
            self.send_json(payload, 404)
            return

        payload = {"aircraft": aircraft}
        cache_set(cache_key, payload)
        self.send_json(payload)

    def handle_flights_route(self, parsed: urllib.parse.ParseResult):
        """Origem / destino estimados pelo callsign (adsbdb + hexdb)."""
        qs = urllib.parse.parse_qs(parsed.query)
        cs = (qs.get("callsign", [""])[0] or "").strip().upper().replace(" ", "")
        if len(cs) < 3:
            self.send_json({"error": "invalid_callsign"}, 400)
            return
        cache_key = f"route:{cs}"
        cached = cache_get(cache_key, 3600.0)
        if cached is not None:
            self.send_json(cached)
            return

        route = None
        # 1) adsbdb — rota rica
        try:
            st, body = fetch_url(
                f"https://api.adsbdb.com/v0/callsign/{urllib.parse.quote(cs)}",
                timeout=12,
                accept="application/json",
                extra_headers={"User-Agent": "KeClima/0.4 (weather-pwa)"},
            )
            if st == 200:
                j = json.loads(body.decode("utf-8", errors="replace"))
                fr = (j.get("response") or {}).get("flightroute") or {}
                if fr:
                    origin = fr.get("origin") or {}
                    dest = fr.get("destination") or {}
                    airline = fr.get("airline") or {}
                    route = {
                        "callsign": fr.get("callsign") or cs,
                        "callsignIata": fr.get("callsign_iata"),
                        "airline": airline.get("name"),
                        "airlineIcao": airline.get("icao"),
                        "airlineIata": airline.get("iata"),
                        "originIcao": origin.get("icao_code"),
                        "originIata": origin.get("iata_code"),
                        "originName": origin.get("name"),
                        "originCity": origin.get("municipality"),
                        "originCountry": origin.get("country_name"),
                        "originLat": origin.get("latitude"),
                        "originLon": origin.get("longitude"),
                        "destIcao": dest.get("icao_code"),
                        "destIata": dest.get("iata_code"),
                        "destName": dest.get("name"),
                        "destCity": dest.get("municipality"),
                        "destCountry": dest.get("country_name"),
                        "destLat": dest.get("latitude"),
                        "destLon": dest.get("longitude"),
                        "routeCode": None,
                        "source": "adsbdb",
                    }
                    o = route["originIcao"] or route["originIata"]
                    d = route["destIcao"] or route["destIata"]
                    if o and d:
                        route["routeCode"] = f"{o}-{d}"
        except Exception:  # noqa: BLE001
            pass

        # 2) hexdb fallback
        if not route or not route.get("routeCode"):
            try:
                st, body = fetch_url(
                    f"https://hexdb.io/api/v1/route/icao/{urllib.parse.quote(cs)}",
                    timeout=10,
                    accept="application/json",
                    extra_headers={
                        "User-Agent": "KeClima/0.4 (weather-pwa)",
                        "Referer": "https://hexdb.io/",
                    },
                )
                if st == 200:
                    j = json.loads(body.decode("utf-8", errors="replace"))
                    code = j.get("route") or ""
                    parts = code.split("-") if code else []
                    if not route:
                        route = {
                            "callsign": j.get("flight") or cs,
                            "callsignIata": None,
                            "airline": None,
                            "airlineIcao": None,
                            "airlineIata": None,
                            "originIcao": parts[0] if len(parts) > 0 else None,
                            "originIata": None,
                            "originName": None,
                            "originCity": None,
                            "originCountry": None,
                            "originLat": None,
                            "originLon": None,
                            "destIcao": parts[1] if len(parts) > 1 else None,
                            "destIata": None,
                            "destName": None,
                            "destCity": None,
                            "destCountry": None,
                            "destLat": None,
                            "destLon": None,
                            "routeCode": code or None,
                            "source": "hexdb",
                        }
                    else:
                        if not route.get("routeCode") and code:
                            route["routeCode"] = code
                            if len(parts) >= 2:
                                route["originIcao"] = route.get("originIcao") or parts[0]
                                route["destIcao"] = route.get("destIcao") or parts[1]
                            route["source"] = (route.get("source") or "") + "+hexdb"
            except Exception:  # noqa: BLE001
                pass

        if not route:
            payload = {"route": None, "error": "not_found"}
            cache_set(cache_key, payload)
            self.send_json(payload, 404)
            return

        payload = {"route": route}
        cache_set(cache_key, payload)
        self.send_json(payload)

    def handle_flights_live(self, parsed: urllib.parse.ParseResult):
        """Proxy OpenSky Network — estados de aeronaves em um bounding box."""
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            west = float(qs.get("west", ["-47"])[0])
            south = float(qs.get("south", ["-24"])[0])
            east = float(qs.get("east", ["-45"])[0])
            north = float(qs.get("north", ["-22"])[0])
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return

        include_ground = qs.get("ground", ["0"])[0] in ("1", "true", "yes")

        # Normaliza e limita área (evita payload enorme / rate limit)
        if west > east:
            west, east = east, west
        if south > north:
            south, north = north, south
        # Clamp global
        south = max(-90.0, min(90.0, south))
        north = max(-90.0, min(90.0, north))
        west = max(-180.0, min(180.0, west))
        east = max(-180.0, min(180.0, east))

        max_span = 8.0  # graus
        lat_span = north - south
        lon_span = east - west
        if lat_span > max_span or lon_span > max_span:
            clat = (south + north) / 2
            clon = (west + east) / 2
            half = max_span / 2
            south, north = clat - half, clat + half
            west, east = clon - half, clon + half

        cache_key = f"opensky:{west:.2f},{south:.2f},{east:.2f},{north:.2f}:{int(include_ground)}"
        cached = cache_get(cache_key, 10.0)
        if cached is not None:
            self.send_json(cached)
            return

        params = urllib.parse.urlencode(
            {
                "lamin": f"{south:.4f}",
                "lomin": f"{west:.4f}",
                "lamax": f"{north:.4f}",
                "lomax": f"{east:.4f}",
            }
        )
        url = f"https://opensky-network.org/api/states/all?{params}"
        try:
            status, body = fetch_url(
                url,
                timeout=20,
                accept="application/json",
                extra_headers={
                    "User-Agent": "KeClima/0.6 (weather-pwa; opensky-proxy)",
                    "Referer": "https://opensky-network.org/",
                    "Origin": "https://opensky-network.org",
                },
            )
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": "proxy_failed", "detail": str(exc)}, 502)
            return

        if status == 429:
            self.send_json(
                {
                    "error": "rate_limited",
                    "detail": "OpenSky rate limit — tente em alguns segundos",
                    "flights": [],
                    "count": 0,
                    "source": "OpenSky Network",
                },
                429,
            )
            return

        if status != 200:
            self.send_json(
                {
                    "error": "opensky_http",
                    "detail": f"HTTP {status}",
                    "flights": [],
                    "count": 0,
                },
                502 if status >= 500 else status,
            )
            return

        try:
            raw = json.loads(body.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            self.send_json({"error": "invalid_json", "flights": [], "count": 0}, 502)
            return

        states = raw.get("states") or []
        flights = []
        max_flights = 250
        for st in states:
            if not st or len(st) < 8:
                continue
            lon = st[5]
            lat = st[6]
            if lon is None or lat is None:
                continue
            on_ground = bool(st[8]) if st[8] is not None else False
            if on_ground and not include_ground:
                continue
            callsign = (st[1] or "").strip() or None
            flights.append(
                {
                    "icao24": st[0],
                    "callsign": callsign,
                    "originCountry": st[2],
                    "longitude": float(lon),
                    "latitude": float(lat),
                    "altitudeM": float(st[7]) if st[7] is not None else None,
                    "geoAltitudeM": float(st[13]) if len(st) > 13 and st[13] is not None else None,
                    "onGround": on_ground,
                    "velocityMs": float(st[9]) if st[9] is not None else None,
                    "trackDeg": float(st[10]) if st[10] is not None else None,
                    "verticalRateMs": float(st[11]) if st[11] is not None else None,
                    "squawk": st[14] if len(st) > 14 else None,
                }
            )
            if len(flights) >= max_flights:
                break

        payload = {
            "time": raw.get("time"),
            "count": len(flights),
            "flights": flights,
            "source": "OpenSky Network",
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "truncated": len(flights) >= max_flights,
        }
        cache_set(cache_key, payload)
        self.send_json(payload)

    def send_json(self, obj, status: int = 200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def official_links(station, lat, lon):
    code = station["code"] if station else None
    return {
        "inmetPortal": "https://portal.inmet.gov.br/",
        "inmetTempo": "https://tempo.inmet.gov.br/",
        "inmetAlerts": "https://alertas2.inmet.gov.br/",
        "inmetStationTable": f"https://tempo.inmet.gov.br/TabelaEstacoes/T" if code else "https://tempo.inmet.gov.br/TabelaEstacoes/T",
        "inmetMaps": "https://mapas.inmet.gov.br/",
        "defesaCivil": "https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil/defesa-civil-alerta",
        "defesaCivilAlerta": "https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil",
        "openMeteo": "https://open-meteo.com/",
    }


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"KeClima em http://localhost:{PORT}")
    print("Proxy FIRMS:  /api/firms/hotspots")
    print("Focos unidos: /api/fires/hotspots  (INPE + FIRMS)")
    print("Desmate DETER: /api/deforestation/alerts")
    print("Proxy INMET:  /api/inmet/nearest?lat=&lon=")
    print("Voos ao vivo: /api/flights/live?west=&south=&east=&north=  (OpenSky)")
    print("Aeronave:     /api/flights/aircraft?icao24=")
    print("Rota:         /api/flights/route?callsign=")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrado.")


if __name__ == "__main__":
    main()
