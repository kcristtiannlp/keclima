#!/usr/bin/env python3
"""
KeClima static server + proxies (FIRMS + INPE Queimadas + INMET + OpenSky voos).

Uso:
  python3 serve.py
  python3 serve.py 8080
  PORT=10000 python3 serve.py   # PaaS (Render/Railway/Fly)
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import websockets  # type: ignore

    HAS_WEBSOCKETS = True
except ImportError:  # pragma: no cover
    websockets = None  # type: ignore
    HAS_WEBSOCKETS = False

ROOT = Path(__file__).resolve().parent
APP_VERSION = "0.7.4"


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


def _goes_stamp_to_iso(stamp: str) -> str | None:
    """Converte carimbo NOAA YYYYJJJHHMM (ano+dia do ano+HHMM) → ISO UTC."""
    if not stamp or len(stamp) < 11:
        return None
    try:
        year = int(stamp[0:4])
        doy = int(stamp[4:7])
        hour = int(stamp[7:9])
        minute = int(stamp[9:11])
        dt = datetime(year, 1, 1, hour, minute, tzinfo=timezone.utc) + timedelta(days=doy - 1)
        return dt.isoformat().replace("+00:00", "Z")
    except (ValueError, OverflowError):
        return None


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


def _point_in_ring(lon: float, lat: float, ring: list) -> bool:
    """Ray casting em anel GeoJSON [lon, lat]."""
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        try:
            xi, yi = float(ring[i][0]), float(ring[i][1])
            xj, yj = float(ring[j][0]), float(ring[j][1])
        except (TypeError, ValueError, IndexError):
            j = i
            continue
        intersects = (yi > lat) != (yj > lat)
        if intersects:
            x_cross = (xj - xi) * (lat - yi) / ((yj - yi) or 1e-15) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def _point_in_geojson(lon: float, lat: float, geom) -> bool:
    if not geom:
        return False
    if isinstance(geom, str):
        try:
            geom = json.loads(geom)
        except json.JSONDecodeError:
            return False
    if not isinstance(geom, dict):
        return False
    gtype = (geom.get("type") or "").lower()
    coords = geom.get("coordinates")
    if gtype == "polygon" and coords:
        # exterior ring only
        return _point_in_ring(lon, lat, coords[0] or [])
    if gtype == "multipolygon" and coords:
        for poly in coords:
            if poly and _point_in_ring(lon, lat, poly[0] or []):
                return True
    return False


def _inmet_severity_level(sev: str | None, color: str | None) -> str:
    s = (sev or "").lower()
    c = (color or "").upper()
    if "grande" in s or "iminente" in s or c in ("#FF0000", "#C00000", "#FF0000"):
        return "danger"
    if "perigo" in s and "potencial" not in s:
        return "danger"
    if "potencial" in s or c in ("#FFFE00", "#FFFF00", "#FFD700"):
        return "warning"
    return "info"


def fetch_inmet_alerts(lat: float | None = None, lon: float | None = None) -> dict:
    """
    Avisos ativos INMET (hoje + futuro) via apiprevmet3.
    Filtra por ponto no polígono quando lat/lon informados.
    """
    cache_key = "inmet_avisos_ativos"
    raw = cache_get(cache_key, 300.0)
    if raw is None:
        url = "https://apiprevmet3.inmet.gov.br/avisos/ativos"
        status, body = fetch_url(url, timeout=25, accept="application/json")
        if status != 200 or not body:
            raise RuntimeError(f"inmet_avisos_http_{status}")
        raw = json.loads(body.decode("utf-8", errors="replace"))
        cache_set(cache_key, raw)

    buckets = []
    for key in ("hoje", "futuro"):
        for item in raw.get(key) or []:
            if item.get("encerrado"):
                continue
            buckets.append((key, item))

    alerts = []
    for when, item in buckets:
        geom = item.get("poligono")
        hits = True
        if lat is not None and lon is not None:
            hits = _point_in_geojson(lon, lat, geom)
            # fallback fraco: se polígono inválido, não inclui
            if not hits and not geom:
                hits = False
        if not hits:
            continue

        riscos = item.get("riscos") or []
        if isinstance(riscos, str):
            riscos = [riscos]
        instrucoes = item.get("instrucoes") or []
        if isinstance(instrucoes, str):
            instrucoes = [instrucoes]

        sev = item.get("severidade") or ""
        level = _inmet_severity_level(sev, item.get("aviso_cor"))
        desc = (item.get("descricao") or "Aviso meteorológico").strip()
        risco_txt = " ".join(str(r).strip() for r in riscos if r).strip()
        message = f"Aviso de condições meteorológicas extremas — {desc}"
        if risco_txt:
            message = f"{message}. {risco_txt}"

        alerts.append(
            {
                "id": f"inmet-{item.get('id') or item.get('id_aviso')}",
                "idAviso": item.get("id_aviso"),
                "source": "INMET",
                "provider": "Instituto Nacional de Meteorologia",
                "title": desc,
                "event": desc,
                "severity": level,
                "severityLabel": sev,
                "color": item.get("aviso_cor"),
                "message": message,
                "risks": [str(r).strip() for r in riscos if r],
                "instructions": [str(i).strip() for i in instrucoes if i],
                "start": item.get("inicio") or item.get("data_inicio"),
                "end": item.get("fim") or item.get("data_fim"),
                "states": item.get("estados"),
                "regions": item.get("regioes"),
                "when": when,  # hoje | futuro
                "url": "https://alertas2.inmet.gov.br/",
            }
        )

    # futuros depois, mais graves primeiro
    order = {"danger": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: (0 if a.get("when") == "hoje" else 1, order.get(a.get("severity"), 9)))

    return {
        "count": len(alerts),
        "alerts": alerts,
        "source": "INMET Alert-AS",
        "sourceUrl": "https://alertas2.inmet.gov.br/",
        "filtered": lat is not None and lon is not None,
        "location": {"latitude": lat, "longitude": lon} if lat is not None else None,
        "disclaimer": (
            "Avisos oficiais do INMET (Alert-AS). "
            "Não confundir com previsão por modelo. Fonte: apiprevmet3.inmet.gov.br."
        ),
    }


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
        # Área grande: junta CSVs regionais + MODIS global (não só a região do usuário)
        lat_span = abs(north - south)
        lon_span = abs(east - west)
        regions = set()
        if lat_span >= 20 or lon_span >= 20:
            regions.update(FIRMS_PUBLIC.keys())
        else:
            regions.add(pick_region(lat, lon))
            # cantos do bbox também (transcontinental)
            for la, lo in (
                (south, west),
                (south, east),
                (north, west),
                (north, east),
                ((south + north) / 2, (west + east) / 2),
            ):
                regions.add(pick_region(la, lo))
            regions.add("world_modis")
        pts = []
        labels = []
        for region in regions:
            url = FIRMS_PUBLIC.get(region)
            if not url:
                continue
            try:
                status, raw = fetch_url(url, accept="text/csv,text/plain,*/*", timeout=50)
                if status != 200:
                    continue
                text_csv = raw.decode("utf-8", errors="replace")
                chunk = parse_firms_csv(text_csv, west, south, east, north)
                pts.extend(chunk)
                labels.append(region)
            except Exception:  # noqa: BLE001
                continue
        # dedupe por lat/lon arredondado
        seen = set()
        uniq = []
        for p in pts:
            k = (round(p["latitude"], 3), round(p["longitude"], 3))
            if k in seen:
                continue
            seen.add(k)
            uniq.append(p)
        pts = uniq
        label = "firms_public_" + "+".join(labels[:6]) if labels else "firms_public"
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
                    "inmet_alerts_proxy": True,
                    "inpe_proxy": True,
                    "fires_merged": True,
                    "deforestation_proxy": True,
                    "flights_proxy": True,
                    "ships_proxy": True,
                    "iss_proxy": True,
                    "earthquakes_proxy": True,
                    "eonet_proxy": True,
                    "satellite_proxy": True,
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
        if parsed.path == "/api/inmet/alerts":
            self.handle_inmet_alerts(parsed)
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
        if parsed.path == "/api/ships/live":
            self.handle_ships_live(parsed)
            return
        if parsed.path == "/api/iss/now":
            self.handle_iss_now(parsed)
            return
        if parsed.path == "/api/earthquakes/live":
            self.handle_earthquakes_live(parsed)
            return
        if parsed.path == "/api/eonet/events":
            self.handle_eonet_events(parsed)
            return
        if parsed.path == "/api/satellite/goes":
            self.handle_satellite_goes(parsed)
            return
        return super().do_GET()

    def handle_inmet_alerts(self, parsed: urllib.parse.ParseResult):
        """Avisos meteorológicos oficiais INMET (Alert-AS) filtrados por ponto."""
        qs = urllib.parse.parse_qs(parsed.query)
        lat = lon = None
        try:
            if qs.get("lat") and qs.get("lon"):
                lat = float(qs.get("lat", [None])[0])
                lon = float(qs.get("lon", [None])[0])
        except (TypeError, ValueError):
            self.send_json({"error": "invalid_params"}, 400)
            return

        try:
            payload = fetch_inmet_alerts(lat, lon)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": "inmet_alerts_failed", "detail": str(exc)}, 502)
            return
        self.send_json(payload)

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
            # limita só extremos (continente ok; evita WFS gigante)
            if abs(east - west) > 40:
                half = 20
                west, east = lon - half, lon + half
            if abs(north - south) > 40:
                half = 20
                south, north = lat - half, lat + half
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return

        # DETER só existe no Brasil — interseção do viewport com bbox BR
        br_west, br_south, br_east, br_north = -75.0, -35.0, -30.0, 6.0
        iw = max(west, br_west)
        is_ = max(south, br_south)
        ie = min(east, br_east)
        in_ = min(north, br_north)
        if iw >= ie or is_ >= in_:
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
        west, south, east, north = iw, is_, ie, in_
        lat = (south + north) / 2
        lon = (west + east) / 2

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

        # ground=1 por padrão (mais aviões no mapa; solo com estilo diferente no front)
        include_ground = qs.get("ground", ["1"])[0] not in ("0", "false", "no")
        force_global = qs.get("global", ["0"])[0] in ("1", "true", "yes")

        # Normaliza bbox
        if west > east:
            west, east = east, west
        if south > north:
            south, north = north, south
        south = max(-90.0, min(90.0, south))
        north = max(-90.0, min(90.0, north))
        west = max(-180.0, min(180.0, west))
        east = max(-180.0, min(180.0, east))

        lat_span = max(0.01, north - south)
        lon_span = max(0.01, east - west)
        # Dump mundial só em zoom muito aberto. Continentes usam bbox da OpenSky
        # (antes: dump global + corte nos 1200 primeiros = quase nenhum voo no BR).
        use_global = force_global or lat_span >= 85.0 or lon_span >= 120.0

        # Alinha bbox a uma grade de 1.0 grau para maximizar cache hits de voos e evitar 429
        if not use_global:
            west = float(math.floor(west))
            south = float(math.floor(south))
            east = float(math.ceil(east))
            north = float(math.ceil(north))
            lat_span = north - south
            lon_span = east - west

        cache_key = (
            f"opensky:global:v2:{int(include_ground)}"
            if use_global
            else f"opensky:v2:{west:.2f},{south:.2f},{east:.2f},{north:.2f}:{int(include_ground)}"
        )
        cached_raw = _CACHE.get(cache_key)
        is_fresh = False
        if cached_raw:
            ts, val = cached_raw
            if time.time() - ts <= (15.0 if use_global else 10.0):
                is_fresh = True

        if is_fresh and cached_raw:
            cached = cached_raw[1]
            if use_global and lat_span < 160 and lon_span < 340:
                filtered = [
                    f
                    for f in cached.get("flights") or []
                    if south <= f["latitude"] <= north and west <= f["longitude"] <= east
                ]
                max_n = 2500
                truncated = len(filtered) > max_n
                filtered = filtered[:max_n]
                out = {
                    **cached,
                    "flights": filtered,
                    "count": len(filtered),
                    "bbox": {"west": west, "south": south, "east": east, "north": north},
                    "scope": "global_filtered",
                    "truncated": truncated or cached.get("truncated", False),
                }
                self.send_json(out)
                return
            self.send_json(cached)
            return

        def get_stale_fallback():
            if cached_raw and time.time() - cached_raw[0] <= 240.0: # fallback de até 4 minutos
                stale_cached = cached_raw[1]
                if use_global and lat_span < 160 and lon_span < 340:
                    filtered = [
                        f
                        for f in stale_cached.get("flights") or []
                        if south <= f["latitude"] <= north and west <= f["longitude"] <= east
                    ]
                    max_n = 2500
                    return {
                        **stale_cached,
                        "flights": filtered[:max_n],
                        "count": len(filtered[:max_n]),
                        "bbox": {"west": west, "south": south, "east": east, "north": north},
                        "scope": "stale_fallback",
                        "truncated": len(filtered) > max_n or stale_cached.get("truncated", False),
                    }
                return {
                    **stale_cached,
                    "scope": "stale_fallback",
                }
            return None

        # Suporte a credenciais OpenSky via env
        import os
        import base64
        usr = os.environ.get("OPENSKY_USERNAME") or os.environ.get("OPENSKY_USER")
        pwd = os.environ.get("OPENSKY_PASSWORD") or os.environ.get("OPENSKY_PASS")
        extra_headers = {
            "User-Agent": "KeClima/0.6 (weather-pwa; opensky-proxy)",
            "Referer": "https://opensky-network.org/",
            "Origin": "https://opensky-network.org",
        }
        if usr and pwd:
            auth_str = f"{usr.strip()}:{pwd.strip()}"
            auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
            extra_headers["Authorization"] = f"Basic {auth_b64}"

        def try_adsb_lol_fallback():
            lat = (south + north) / 2.0
            lon = (west + east) / 2.0
            r_km = haversine_km(lat, lon, north, east)
            radius_nm = max(15, min(250, int(r_km / 1.852) + 10))
            adsb_url = f"https://api.adsb.lol/v2/point/{lat:.4f}/{lon:.4f}/{radius_nm}"
            try:
                st, bd = fetch_url(
                    adsb_url,
                    timeout=15,
                    accept="application/json",
                    extra_headers={"User-Agent": "KeClima/0.6 (weather-pwa; adsb-proxy)"},
                )
                if st == 200 and bd:
                    raw = json.loads(bd.decode("utf-8", errors="replace"))
                    ac_list = raw.get("ac") or []
                    f_list = []
                    for ac in ac_list:
                        item_lat = ac.get("lat")
                        item_lon = ac.get("lon")
                        if item_lat is None or item_lon is None:
                            continue
                        try:
                            lat_f = float(item_lat)
                            lon_f = float(item_lon)
                        except (TypeError, ValueError):
                            continue
                        if not (south <= lat_f <= north and west <= lon_f <= east):
                            continue

                        alt_baro = ac.get("alt_baro")
                        on_ground = alt_baro == "ground"

                        alt_m = None
                        if alt_baro is not None and not on_ground:
                            try:
                                alt_m = float(alt_baro) * 0.3048
                            except (TypeError, ValueError):
                                pass

                        gs = ac.get("gs")
                        vel_ms = None
                        if gs is not None:
                            try:
                                vel_ms = float(gs) * 0.514444
                            except (TypeError, ValueError):
                                pass

                        callsign = (ac.get("flight") or "").strip() or None
                        if not callsign and ac.get("r"):
                            callsign = ac.get("r").strip()

                        f_list.append(
                            {
                                "icao24": ac.get("hex", "").strip().lower(),
                                "callsign": callsign,
                                "originCountry": None,
                                "longitude": lon_f,
                                "latitude": lat_f,
                                "altitudeM": alt_m,
                                "geoAltitudeM": None,
                                "onGround": on_ground,
                                "velocityMs": vel_ms,
                                "trackDeg": float(ac.get("track", 0)) if ac.get("track") is not None else None,
                                "verticalRateMs": None,
                                "squawk": ac.get("squawk"),
                            }
                        )
                    max_n = 2500
                    payload = {
                        "time": int(time.time()),
                        "count": len(f_list[:max_n]),
                        "flights": f_list[:max_n],
                        "source": "ADSB.lol (Fallback)",
                        "bbox": {"west": west, "south": south, "east": east, "north": north},
                        "truncated": len(f_list) > max_n,
                        "scope": "bbox_fallback",
                    }
                    cache_set(cache_key, payload)
                    return payload
            except Exception:  # noqa: BLE001
                pass
            return None

        # Integração ADSB.lol (unfiltered & open) para todos os zoom levels
        adsb_success = False
        flights_all = []

        if not use_global:
            lat = (south + north) / 2.0
            lon = (west + east) / 2.0
            r_km = haversine_km(lat, lon, north, east)
            radius_nm = max(15, min(250, int(r_km / 1.852) + 10))
            adsb_url = f"https://api.adsb.lol/v2/point/{lat:.4f}/{lon:.4f}/{radius_nm}"
            try:
                status, body = fetch_url(
                    adsb_url,
                    timeout=15,
                    accept="application/json",
                    extra_headers={"User-Agent": "KeClima/0.6 (weather-pwa; adsb-proxy)"},
                )
                if status == 200 and body:
                    raw = json.loads(body.decode("utf-8", errors="replace"))
                    ac_list = raw.get("ac") or []
                    for ac in ac_list:
                        item_lat = ac.get("lat")
                        item_lon = ac.get("lon")
                        if item_lat is None or item_lon is None:
                            continue
                        try:
                            lat_f = float(item_lat)
                            lon_f = float(item_lon)
                        except (TypeError, ValueError):
                            continue

                        # Filtra pela área de exibição
                        if not (south <= lat_f <= north and west <= lon_f <= east):
                            continue

                        # Altitudes: pés para metros
                        alt_baro = ac.get("alt_baro")
                        on_ground = alt_baro == "ground"

                        alt_m = None
                        if alt_baro is not None and not on_ground:
                            try:
                                alt_m = float(alt_baro) * 0.3048
                            except (TypeError, ValueError):
                                pass

                        alt_geom = ac.get("alt_geom")
                        alt_geom_m = None
                        if alt_geom is not None and alt_geom != "ground":
                            try:
                                alt_geom_m = float(alt_geom) * 0.3048
                            except (TypeError, ValueError):
                                pass

                        # Velocidade: nós para m/s
                        gs = ac.get("gs")
                        vel_ms = None
                        if gs is not None:
                            try:
                                vel_ms = float(gs) * 0.514444
                            except (TypeError, ValueError):
                                pass

                        # Razão vertical: ft/min para m/s
                        baro_rate = ac.get("baro_rate")
                        geom_rate = ac.get("geom_rate")
                        rate = baro_rate if baro_rate is not None else geom_rate
                        rate_ms = None
                        if rate is not None:
                            try:
                                rate_ms = float(rate) * 0.00508
                            except (TypeError, ValueError):
                                pass

                        callsign = (ac.get("flight") or "").strip() or None
                        if not callsign and ac.get("r"):
                            callsign = ac.get("r").strip()

                        flights_all.append(
                            {
                                "icao24": ac.get("hex", "").strip().lower(),
                                "callsign": callsign,
                                "originCountry": None,
                                "longitude": lon_f,
                                "latitude": lat_f,
                                "altitudeM": alt_m,
                                "geoAltitudeM": alt_geom_m,
                                "onGround": on_ground,
                                "velocityMs": vel_ms,
                                "trackDeg": float(ac.get("track", 0)) if ac.get("track") is not None else None,
                                "verticalRateMs": rate_ms,
                                "squawk": ac.get("squawk"),
                            }
                        )
                    adsb_success = True
            except Exception:  # noqa: BLE001
                pass

        if adsb_success:
            max_n = 2500
            truncated = len(flights_all) > max_n
            flights = flights_all[:max_n]
            payload = {
                "time": int(time.time()),
                "count": len(flights),
                "flights": flights,
                "source": "ADSB.lol",
                "bbox": {"west": west, "south": south, "east": east, "north": north},
                "truncated": truncated,
                "scope": "bbox",
            }
            cache_set(cache_key, payload)
            self.send_json(payload)
            return

        # Fallback para OpenSky Network
        if use_global:
            url = "https://opensky-network.org/api/states/all"
        else:
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
                timeout=40 if use_global else 25,
                accept="application/json",
                extra_headers=extra_headers,
            )
        except Exception as exc:  # noqa: BLE001
            fb = get_stale_fallback() or try_adsb_lol_fallback()
            if fb:
                self.send_json(fb)
                return
            self.send_json({"error": "proxy_failed", "detail": str(exc)}, 502)
            return

        if status == 429:
            fb = get_stale_fallback() or try_adsb_lol_fallback()
            if fb:
                self.send_json(fb)
                return
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
            fb = get_stale_fallback() or try_adsb_lol_fallback()
            if fb:
                self.send_json(fb)
                return
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
        # IMPORTANTE: filtrar por bbox ANTES de limitar quantidade
        # (no dump global, os primeiros N estados são quase todos Europa/EUA)
        flights_all = []
        for st in states:
            if not st or len(st) < 8:
                continue
            lon = st[5]
            lat = st[6]
            if lon is None or lat is None:
                continue
            try:
                lat_f = float(lat)
                lon_f = float(lon)
            except (TypeError, ValueError):
                continue
            if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
                continue
            # no modo bbox da API, ainda re-filtra por segurança
            if not use_global and not (south <= lat_f <= north and west <= lon_f <= east):
                continue
            # no dump global, guarda tudo com posição (filtro na resposta)
            on_ground = bool(st[8]) if st[8] is not None else False
            if on_ground and not include_ground:
                continue
            callsign = (st[1] or "").strip() or None
            flights_all.append(
                {
                    "icao24": st[0],
                    "callsign": callsign,
                    "originCountry": st[2],
                    "longitude": lon_f,
                    "latitude": lat_f,
                    "altitudeM": float(st[7]) if st[7] is not None else None,
                    "geoAltitudeM": float(st[13]) if len(st) > 13 and st[13] is not None else None,
                    "onGround": on_ground,
                    "velocityMs": float(st[9]) if st[9] is not None else None,
                    "trackDeg": float(st[10]) if st[10] is not None else None,
                    "verticalRateMs": float(st[11]) if st[11] is not None else None,
                    "squawk": st[14] if len(st) > 14 else None,
                }
            )

        if use_global:
            # cache: amostra ampla mundial (para refiltrar por viewport)
            max_cache = 6000
            truncated_cache = len(flights_all) > max_cache
            # prioriza em voo no cache
            flights_all.sort(key=lambda f: (f.get("onGround") is True, -(f.get("velocityMs") or 0)))
            cache_flights = flights_all[:max_cache]
            payload_full = {
                "time": raw.get("time"),
                "count": len(cache_flights),
                "flights": cache_flights,
                "source": "OpenSky Network",
                "bbox": {"west": -180, "south": -90, "east": 180, "north": 90},
                "truncated": truncated_cache,
                "scope": "global",
                "rawStates": len(states),
            }
            cache_set(cache_key, payload_full)

            filtered = [
                f
                for f in cache_flights
                if south <= f["latitude"] <= north and west <= f["longitude"] <= east
            ]
            # se o cache global não cobriu a região, tenta bbox direto como complemento
            if len(filtered) < 15 and lat_span < 80 and lon_span < 100:
                try:
                    params = urllib.parse.urlencode(
                        {
                            "lamin": f"{south:.4f}",
                            "lomin": f"{west:.4f}",
                            "lamax": f"{north:.4f}",
                            "lomax": f"{east:.4f}",
                        }
                    )
                    url2 = f"https://opensky-network.org/api/states/all?{params}"
                    st2, body2 = fetch_url(
                        url2,
                        timeout=20,
                        accept="application/json",
                        extra_headers={
                            "User-Agent": "KeClima/0.6 (weather-pwa; opensky-proxy)",
                            "Referer": "https://opensky-network.org/",
                        },
                    )
                    if st2 == 200 and body2:
                        raw2 = json.loads(body2.decode("utf-8", errors="replace"))
                        by_id = {f["icao24"]: f for f in filtered if f.get("icao24")}
                        for st in raw2.get("states") or []:
                            if not st or len(st) < 8 or st[5] is None or st[6] is None:
                                continue
                            on_ground = bool(st[8]) if st[8] is not None else False
                            if on_ground and not include_ground:
                                continue
                            icao = st[0]
                            by_id[icao] = {
                                "icao24": icao,
                                "callsign": (st[1] or "").strip() or None,
                                "originCountry": st[2],
                                "longitude": float(st[5]),
                                "latitude": float(st[6]),
                                "altitudeM": float(st[7]) if st[7] is not None else None,
                                "geoAltitudeM": float(st[13])
                                if len(st) > 13 and st[13] is not None
                                else None,
                                "onGround": on_ground,
                                "velocityMs": float(st[9]) if st[9] is not None else None,
                                "trackDeg": float(st[10]) if st[10] is not None else None,
                                "verticalRateMs": float(st[11]) if st[11] is not None else None,
                                "squawk": st[14] if len(st) > 14 else None,
                            }
                        filtered = list(by_id.values())
                except Exception:  # noqa: BLE001
                    pass

            max_n = 2500
            truncated = len(filtered) > max_n
            filtered = filtered[:max_n]
            self.send_json(
                {
                    "time": raw.get("time"),
                    "count": len(filtered),
                    "flights": filtered,
                    "source": "OpenSky Network",
                    "bbox": {"west": west, "south": south, "east": east, "north": north},
                    "scope": "global_filtered",
                    "truncated": truncated or truncated_cache,
                    "rawStates": len(states),
                }
            )
            return

        # Modo bbox: devolve todos do retângulo (limite alto)
        max_n = 2500
        truncated = len(flights_all) > max_n
        flights = flights_all[:max_n]
        payload = {
            "time": raw.get("time"),
            "count": len(flights),
            "flights": flights,
            "source": "OpenSky Network",
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "truncated": truncated,
            "scope": "bbox",
            "rawStates": len(states),
        }
        cache_set(cache_key, payload)
        self.send_json(payload)

    def handle_ships_live(self, parsed: urllib.parse.ParseResult):
        """Navios/AIS: Digitraffic (Europa grátis) + AISStream (chave, global/BR)."""
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            west = float(qs.get("west", ["-180"])[0])
            south = float(qs.get("south", ["-90"])[0])
            east = float(qs.get("east", ["180"])[0])
            north = float(qs.get("north", ["90"])[0])
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return
        if west > east:
            west, east = east, west
        if south > north:
            south, north = north, south

        # Alinha bbox a uma grade de 0.5 grau para maximizar cache hits de navios e evitar bloqueio
        west = float(math.floor(west * 2) / 2)
        south = float(math.floor(south * 2) / 2)
        east = float(math.ceil(east * 2) / 2)
        north = float(math.ceil(north * 2) / 2)

        key = (qs.get("key", [""])[0] or os.environ.get("AISSTREAM_API_KEY") or "").strip()
        outside_europe = not _bbox_overlaps_europe(west, south, east, north)
        needs_key = outside_europe and not key

        ais_ships = []
        ais_err = None
        ais_connected = False
        ais_cache_total = 0
        if key:
            just_started = ensure_aisstream(key, west, south, east, north)
            # Stream é ao vivo: no 1º pedido espera mais (BR/costa demora a encher o cache)
            wait_s = 6.0 if just_started else 2.5
            deadline = time.time() + wait_s
            while True:
                ais_ships, ais_err, ais_connected, _last = aisstream_ships_in_bbox(
                    west, south, east, north
                )
                with _AISSTREAM_LOCK:
                    ais_cache_total = len(_AISSTREAM["ships"])
                if ais_ships or ais_err or time.time() >= deadline:
                    break
                time.sleep(0.45)

        digit_ships = []
        digit_err = None
        digit_src = None
        # Digitraffic só cobre Europa/Báltico — não baixa o feed no BR/oceano
        if not outside_europe:
            try:
                data = fetch_digitraffic_ais()
                digit_src = data.get("source")
                digit_ships = [
                    s
                    for s in data.get("ships") or []
                    if south <= s["latitude"] <= north and west <= s["longitude"] <= east
                ]
            except Exception as exc:  # noqa: BLE001
                digit_err = str(exc)

        # merge por MMSI (AISStream sobrescreve Digitraffic)
        by_mmsi = {}
        for s in digit_ships:
            if s.get("mmsi"):
                by_mmsi[s["mmsi"]] = s
        for s in ais_ships:
            if s.get("mmsi"):
                by_mmsi[s["mmsi"]] = s
        ships = list(by_mmsi.values())
        max_n = 1200
        truncated = len(ships) > max_n
        ships = ships[:max_n]

        sources = []
        if digit_ships:
            sources.append("Digitraffic")
        if ais_ships:
            sources.append("AISStream")
        if not sources:
            sources.append("none")

        if needs_key:
            note = (
                "No Brasil/Américas o feed grátis Digitraffic não tem cobertura. "
                "Cole a chave grátis de aisstream.io em Configurações (login GitHub) "
                "ou defina AISSTREAM_API_KEY no serve.py. Depois reative a camada Navios."
            )
        elif key and not ais_ships and ais_connected:
            note = (
                "AISStream ligado, ainda sem posições nesta área (aguarde ~15–30s; "
                "AIS terrestre depende de estações costeiras — foque portos/litoral)."
            )
        elif key and ais_err and not ais_ships:
            note = (
                f"AISStream: {ais_err}. Verifique a chave em Configurações. "
                "Sem chave válida: só Europa (Digitraffic)."
            )
        elif not key:
            note = (
                "Sem chave AISStream: só Digitraffic (Europa/Báltico). "
                "Com chave grátis em aisstream.io: cobertura mundial (inclui costa do BR)."
            )
        else:
            note = "AISStream + Digitraffic (quando a área se sobrepõe)."
        if not HAS_WEBSOCKETS and key:
            note = "Instale o pacote Python 'websockets' (pip install websockets) para AISStream. " + note

        if not ships and digit_err and not key:
            self.send_json(
                {"error": "ships_failed", "detail": digit_err, "ships": [], "count": 0},
                502,
            )
            return

        self.send_json(
            {
                "count": len(ships),
                "ships": ships,
                "source": " + ".join(sources),
                "coverage": "Digitraffic (EU) + AISStream (chave, global)",
                "coverageNote": note,
                "needsKey": needs_key,
                "region": "outside_europe" if outside_europe else "europe",
                "aisstream": {
                    "enabled": bool(key),
                    "connected": ais_connected,
                    "error": ais_err,
                    "websockets": HAS_WEBSOCKETS,
                    "count": len(ais_ships),
                    "cacheTotal": ais_cache_total,
                    "signup": "https://aisstream.io/apikeys",
                },
                "digitraffic": {"count": len(digit_ships), "error": digit_err, "source": digit_src},
                "bbox": {"west": west, "south": south, "east": east, "north": north},
                "truncated": truncated,
            }
        )

    def handle_iss_now(self, parsed: urllib.parse.ParseResult):  # noqa: ARG002
        """Posição da ISS (gratuita) — exemplo de outro objeto rastreável."""
        cached = cache_get("iss_now", 8.0)
        if cached is not None:
            self.send_json(cached)
            return
        urls = (
            "https://api.wheretheiss.at/v1/satellites/25544",
            "http://api.open-notify.org/iss-now.json",
        )
        last_err = None
        for url in urls:
            try:
                status, raw = fetch_url(url, timeout=12, accept="application/json")
                if status != 200 or not raw:
                    last_err = f"http_{status}"
                    continue
                data = json.loads(raw.decode("utf-8", errors="replace"))
                # normaliza formatos
                if "iss_position" in data:
                    lat = float(data["iss_position"]["latitude"])
                    lon = float(data["iss_position"]["longitude"])
                    payload = {
                        "name": "ISS",
                        "latitude": lat,
                        "longitude": lon,
                        "altitudeKm": None,
                        "velocityKmh": None,
                        "source": "open-notify.org",
                        "timestamp": data.get("timestamp"),
                    }
                else:
                    payload = {
                        "name": data.get("name") or "ISS",
                        "latitude": float(data["latitude"]),
                        "longitude": float(data["longitude"]),
                        "altitudeKm": _num(data.get("altitude")),
                        "velocityKmh": _num(data.get("velocity")),
                        "source": "wheretheiss.at",
                        "timestamp": data.get("timestamp"),
                    }
                cache_set("iss_now", payload)
                self.send_json(payload)
                return
            except Exception as exc:  # noqa: BLE001
                last_err = str(exc)
                continue
        self.send_json({"error": "iss_failed", "detail": last_err}, 502)

    def handle_earthquakes_live(self, parsed: urllib.parse.ParseResult):
        """USGS Earthquake GeoJSON — feed público (sem chave)."""
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            west = float(qs.get("west", ["-180"])[0])
            south = float(qs.get("south", ["-90"])[0])
            east = float(qs.get("east", ["180"])[0])
            north = float(qs.get("north", ["90"])[0])
            min_mag = float(qs.get("minmagnitude", ["2.5"])[0])
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return
        if west > east:
            west, east = east, west
        if south > north:
            south, north = north, south
        min_mag = max(0.0, min(9.0, min_mag))
        # feed semanal M2.5+ (cache global) — filtra bbox no proxy
        period = (qs.get("period", ["week"])[0] or "week").lower()
        if period not in ("day", "week", "month"):
            period = "week"
        # escolha de feed USGS por magnitude mínima
        if min_mag >= 4.5:
            feed = f"4.5_{period}"
        elif min_mag >= 2.5:
            feed = f"2.5_{period}"
        else:
            feed = f"all_{period}"
        cache_key = f"usgs:{feed}"
        cached = cache_get(cache_key, 90.0)
        if cached is None:
            url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed}.geojson"
            try:
                status, raw = fetch_url(url, timeout=25, accept="application/json")
                if status != 200 or not raw:
                    self.send_json({"error": "usgs_http", "detail": f"http_{status}"}, 502)
                    return
                data = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception as exc:  # noqa: BLE001
                self.send_json({"error": "usgs_failed", "detail": str(exc)}, 502)
                return
            cache_set(cache_key, data)
            cached = data

        events = []
        for f in cached.get("features") or []:
            geom = f.get("geometry") or {}
            coords = geom.get("coordinates") or []
            if len(coords) < 2:
                continue
            try:
                lon, lat = float(coords[0]), float(coords[1])
                depth = float(coords[2]) if len(coords) > 2 else None
            except (TypeError, ValueError):
                continue
            props = f.get("properties") or {}
            mag = props.get("mag")
            try:
                mag_f = float(mag) if mag is not None else None
            except (TypeError, ValueError):
                mag_f = None
            if mag_f is not None and mag_f < min_mag:
                continue
            if not (south <= lat <= north and west <= lon <= east):
                continue
            events.append(
                {
                    "id": f.get("id") or props.get("code"),
                    "mag": mag_f,
                    "place": props.get("place"),
                    "time": props.get("time"),
                    "updated": props.get("updated"),
                    "url": props.get("url"),
                    "tsunami": props.get("tsunami"),
                    "type": props.get("type") or "earthquake",
                    "latitude": lat,
                    "longitude": lon,
                    "depthKm": depth,
                    "provider": "usgs",
                }
            )
        events.sort(key=lambda e: (e.get("mag") is None, -(e.get("mag") or 0)))
        max_n = 500
        truncated = len(events) > max_n
        events = events[:max_n]
        self.send_json(
            {
                "count": len(events),
                "events": events,
                "source": "USGS Earthquake Hazards Program",
                "feed": feed,
                "minmagnitude": min_mag,
                "period": period,
                "truncated": truncated,
                "bbox": {"west": west, "south": south, "east": east, "north": north},
            }
        )

    def handle_eonet_events(self, parsed: urllib.parse.ParseResult):
        """NASA EONET v3 — eventos naturais abertos (sem chave)."""
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            west = float(qs.get("west", ["-180"])[0])
            south = float(qs.get("south", ["-90"])[0])
            east = float(qs.get("east", ["180"])[0])
            north = float(qs.get("north", ["90"])[0])
            days = int(qs.get("days", ["30"])[0])
            limit = int(qs.get("limit", ["200"])[0])
        except ValueError:
            self.send_json({"error": "invalid_params"}, 400)
            return
        if west > east:
            west, east = east, west
        if south > north:
            south, north = north, south
        days = max(1, min(365, days))
        limit = max(10, min(500, limit))
        cache_key = f"eonet:open:{days}:{limit}"
        cached = cache_get(cache_key, 180.0)
        if cached is None:
            url = (
                "https://eonet.gsfc.nasa.gov/api/v3/events/geojson"
                f"?status=open&limit={limit}&days={days}"
            )
            try:
                status, raw = fetch_url(url, timeout=30, accept="application/json")
                if status != 200 or not raw:
                    self.send_json({"error": "eonet_http", "detail": f"http_{status}"}, 502)
                    return
                data = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception as exc:  # noqa: BLE001
                self.send_json({"error": "eonet_failed", "detail": str(exc)}, 502)
                return
            cache_set(cache_key, data)
            cached = data

        events = []
        for f in cached.get("features") or []:
            props = f.get("properties") or {}
            geom = f.get("geometry") or {}
            gtype = (geom.get("type") or "").lower()
            coords = geom.get("coordinates")
            lat = lon = None
            if gtype == "point" and isinstance(coords, (list, tuple)) and len(coords) >= 2:
                try:
                    lon, lat = float(coords[0]), float(coords[1])
                except (TypeError, ValueError):
                    continue
            elif gtype == "polygon" and coords:
                # centroid simplificado do anel exterior
                ring = coords[0] if coords else []
                pts = []
                for c in ring or []:
                    if isinstance(c, (list, tuple)) and len(c) >= 2:
                        try:
                            pts.append((float(c[0]), float(c[1])))
                        except (TypeError, ValueError):
                            pass
                if pts:
                    lon = sum(p[0] for p in pts) / len(pts)
                    lat = sum(p[1] for p in pts) / len(pts)
            elif gtype == "linestring" and coords:
                try:
                    mid = coords[len(coords) // 2]
                    lon, lat = float(mid[0]), float(mid[1])
                except (TypeError, ValueError, IndexError):
                    continue
            elif gtype == "geometrycollection":
                # pega primeiro ponto útil
                for g in geom.get("geometries") or []:
                    c = g.get("coordinates")
                    if (g.get("type") or "").lower() == "point" and c and len(c) >= 2:
                        try:
                            lon, lat = float(c[0]), float(c[1])
                            break
                        except (TypeError, ValueError):
                            continue
            if lat is None or lon is None:
                continue
            if not (south <= lat <= north and west <= lon <= east):
                continue
            cats = props.get("categories") or []
            cat_titles = []
            for c in cats:
                if isinstance(c, dict):
                    cat_titles.append(c.get("title") or c.get("id") or "")
                else:
                    cat_titles.append(str(c))
            events.append(
                {
                    "id": props.get("id") or f.get("id"),
                    "title": props.get("title") or props.get("id"),
                    "description": props.get("description"),
                    "link": props.get("link") or props.get("source"),
                    "date": props.get("date"),
                    "categories": [x for x in cat_titles if x],
                    "latitude": lat,
                    "longitude": lon,
                    "geometryType": gtype,
                    "provider": "eonet",
                }
            )
        max_n = 400
        truncated = len(events) > max_n
        events = events[:max_n]
        self.send_json(
            {
                "count": len(events),
                "events": events,
                "source": "NASA EONET v3",
                "days": days,
                "truncated": truncated,
                "bbox": {"west": west, "south": south, "east": east, "north": north},
            }
        )

    def handle_satellite_goes(self, parsed: urllib.parse.ParseResult):
        """
        Lista frames GOES infravermelho (NOAA STAR) — estilo Climatempo satélite IV.
        sector: ssa (América do Sul, padrão) | fd (disco completo) | taw (Atlântico tropical)
        """
        qs = urllib.parse.parse_qs(parsed.query)
        sector = (qs.get("sector", ["ssa"])[0] or "ssa").lower()
        if sector not in ("ssa", "fd", "taw"):
            sector = "ssa"
        size = (qs.get("size", ["900x540"])[0] or "900x540").lower()
        allowed_sizes = ("450x270", "900x540", "1800x1080", "3600x2160")
        if size not in allowed_sizes:
            size = "900x540"
        try:
            limit = int(qs.get("limit", ["36"])[0])
        except ValueError:
            limit = 36
        limit = max(6, min(72, limit))

        sat = "GOES19"
        band = "13"  # Clean IR longwave ~10.3 µm
        if sector == "fd":
            base = f"https://cdn.star.nesdis.noaa.gov/{sat}/ABI/FD/{band}/"
            # Full disk naming: 20261922030_GOES19-ABI-FD-13-1808x1808.jpg etc.
            size_fd = {
                "450x270": "339x339",
                "900x540": "678x678",
                "1800x1080": "1808x1808",
                "3600x2160": "5424x5424",
            }.get(size, "678x678")
            size_token = size_fd
            file_re = re.compile(
                rf'href="(\d{{11}}_{sat}-ABI-FD-{band}-{re.escape(size_token)}\.jpg)"',
                re.I,
            )
            loop_gif = f"{base}{sat}-FD-{band}-678x678.gif"
            sector_label = "Full Disk"
        elif sector == "taw":
            base = f"https://cdn.star.nesdis.noaa.gov/{sat}/ABI/SECTOR/taw/{band}/"
            size_token = size
            file_re = re.compile(
                rf'href="(\d{{11}}_{sat}-ABI-taw-{band}-{re.escape(size_token)}\.jpg)"',
                re.I,
            )
            loop_gif = f"{base}{sat}-TAW-{band}-900x540.gif"
            sector_label = "Tropical Atlantic"
        else:
            base = f"https://cdn.star.nesdis.noaa.gov/{sat}/ABI/SECTOR/ssa/{band}/"
            size_token = size
            file_re = re.compile(
                rf'href="(\d{{11}}_{sat}-ABI-ssa-{band}-{re.escape(size_token)}\.jpg)"',
                re.I,
            )
            loop_gif = f"{base}{sat}-SSA-{band}-900x540.gif"
            sector_label = "Southern South America"

        cache_key = f"goes:{sat}:{sector}:{size_token}:{limit}"
        cached = cache_get(cache_key, 120.0)
        if cached is not None:
            self.send_json(cached)
            return

        try:
            status, raw = fetch_url(base, timeout=25, accept="text/html")
            if status != 200 or not raw:
                self.send_json({"error": "goes_http", "detail": f"http_{status}"}, 502)
                return
            html = raw.decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": "goes_failed", "detail": str(exc)}, 502)
            return

        names = sorted(set(file_re.findall(html)))
        # fallback: tamanho alternativo comum se o pedido falhar
        if not names and size_token != "900x540" and sector != "fd":
            alt = "900x540"
            file_re2 = re.compile(
                rf'href="(\d{{11}}_{sat}-ABI-{sector}-{band}-{re.escape(alt)}\.jpg)"',
                re.I,
            )
            names = sorted(set(file_re2.findall(html)))
            size_token = alt
        if not names and sector == "fd":
            file_re2 = re.compile(
                rf'href="(\d{{11}}_{sat}-ABI-FD-{band}-678x678\.jpg)"',
                re.I,
            )
            names = sorted(set(file_re2.findall(html)))
            size_token = "678x678"

        frames = []
        for name in names[-limit:]:
            stamp = name.split("_", 1)[0]
            iso = _goes_stamp_to_iso(stamp)
            frames.append(
                {
                    "id": stamp,
                    "file": name,
                    "url": base + name,
                    "time": iso,
                    "timeUtc": iso,
                }
            )

        latest_url = base + "latest.jpg"
        # prefer same size "latest" alias when exists
        if size_token and f"{size_token}.jpg" in html:
            # 900x540.jpg is rolling latest for that size
            pass
        size_latest = base + f"{size_token}.jpg" if size_token else latest_url

        payload = {
            "count": len(frames),
            "frames": frames,
            "latest": size_latest if frames else latest_url,
            "latestFull": latest_url,
            "loopGif": loop_gif,
            "sector": sector,
            "sectorLabel": sector_label,
            "satellite": sat,
            "band": band,
            "bandName": "Clean IR (10.3 µm)",
            "size": size_token,
            "source": "NOAA / NESDIS STAR",
            "sourceUrl": base,
            "attribution": "Imagens GOES © NOAA / NESDIS (domínio público)",
            "note": "Infravermelho limpo — realça nuvens altas e frentes; não é foto óptica colorida.",
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


def fetch_digitraffic_ais():
    """Feed AIS gratuito (Digitraffic / Finlândia — cobertura principalmente Europa/Báltico)."""
    cached = cache_get("digitraffic_ais", 45.0)
    if cached is not None:
        return cached
    url = "https://meri.digitraffic.fi/api/ais/v1/locations"
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            raw = resp.read()
            enc = (resp.headers.get("Content-Encoding") or "").lower()
            if "gzip" in enc:
                import gzip

                raw = gzip.decompress(raw)
            data = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"digitraffic_failed:{exc}") from exc
    features = data.get("features") or []
    ships = []
    for f in features:
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        try:
            lon_f = float(lon)
            lat_f = float(lat)
        except (TypeError, ValueError):
            continue
        props = f.get("properties") or {}
        mmsi = f.get("mmsi") or props.get("mmsi")
        ships.append(
            {
                "mmsi": str(mmsi) if mmsi is not None else None,
                "name": None,
                "latitude": lat_f,
                "longitude": lon_f,
                "sog": _num(props.get("sog")),  # knots
                "cog": _num(props.get("cog")),  # course over ground deg
                "heading": _num(props.get("heading")),
                "navStat": props.get("navStat"),
                "timestamp": props.get("timestampExternal") or props.get("timestamp"),
                "provider": "digitraffic",
            }
        )
    payload = {
        "ships": ships,
        "count": len(ships),
        "source": "Digitraffic AIS (Finland)",
        "coverage": "Europe/Baltic primarily — free public AIS feed",
        "updated": data.get("dataUpdatedTime"),
    }
    cache_set("digitraffic_ais", payload)
    return payload


# ─── AISStream (chave opcional) — WebSocket no backend ───────────────────────
_AISSTREAM_LOCK = threading.Lock()
_AISSTREAM = {
    "key": "",
    "ships": {},  # mmsi -> ship dict (com _seen epoch)
    "bbox": None,  # (west,south,east,north)
    "error": None,
    "connected": False,
    "thread": None,
    "stop": None,  # threading.Event
    "loop": None,
    "last_msg": 0.0,
    "started_at": 0.0,
}
# posições AIS expiram (não ficam eternas no mapa)
_AIS_SHIP_TTL_S = 20 * 60


def _bbox_overlaps_europe(west: float, south: float, east: float, north: float) -> bool:
    """Digitraffic cobre principalmente Europa/Báltico (~ lat 35–72, lon −25–45)."""
    eu_w, eu_s, eu_e, eu_n = -25.0, 35.0, 45.0, 72.0
    return not (east < eu_w or west > eu_e or north < eu_s or south > eu_n)


def _expand_stream_bbox(west: float, south: float, east: float, north: float):
    """
    Amplia a assinatura do stream além do viewport.
    AIS terrestre chega aos poucos; bbox grande no litoral BR enche o cache mais rápido.
    """
    # padding generoso
    pad_lon = max(3.0, (east - west) * 0.6)
    pad_lat = max(2.5, (north - south) * 0.6)
    w = west - pad_lon
    e = east + pad_lon
    s = south - pad_lat
    n = north + pad_lat

    # viewport sobre América do Sul atlântica → cobre costa BR principal
    if s < 12 and n > -40 and w < -20 and e > -80:
        w = min(w, -55.0)
        e = max(e, -28.0)
        s = min(s, -35.0)
        n = max(n, 8.0)
    # viewport sobre Caribe / Atlântico norte ocidental
    elif s < 35 and n > 0 and w < -40 and e > -100:
        w = min(w, -100.0)
        e = max(e, -40.0)
        s = min(s, 0.0)
        n = max(n, 35.0)

    # tamanho mínimo ~6°×4° para receber tráfego útil
    if e - w < 6.0:
        mid = (w + e) / 2
        w, e = mid - 3.0, mid + 3.0
    if n - s < 4.0:
        mid = (s + n) / 2
        s, n = mid - 2.0, mid + 2.0

    return (
        max(-180.0, w),
        max(-90.0, s),
        min(180.0, e),
        min(90.0, n),
    )


def _aisstream_prune_locked(now: float | None = None):
    """Remove navios antigos / limita tamanho do cache (chamar com lock)."""
    now = now if now is not None else time.time()
    ships = _AISSTREAM["ships"]
    dead = [k for k, v in ships.items() if now - float(v.get("_seen") or 0) > _AIS_SHIP_TTL_S]
    for k in dead:
        ships.pop(k, None)
    if len(ships) > 10000:
        ordered = sorted(ships.items(), key=lambda kv: float(kv[1].get("_seen") or 0))
        for k, _ in ordered[: len(ordered) // 5]:
            ships.pop(k, None)


def _aisstream_upsert(msg: dict):
    """Extrai posição de mensagem AISStream."""
    meta = msg.get("MetaData") or {}
    mtype = msg.get("MessageType") or ""
    body = (msg.get("Message") or {}).get(mtype) or {}
    lat = meta.get("latitude")
    lon = meta.get("longitude")
    if lat is None:
        lat = body.get("Latitude") if body.get("Latitude") is not None else body.get("latitude")
    if lon is None:
        lon = body.get("Longitude") if body.get("Longitude") is not None else body.get("longitude")
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return
    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
        return
    # ignora posições nulas típicas de relatório inválido
    if abs(lat_f) < 1e-6 and abs(lon_f) < 1e-6:
        return
    mmsi = meta.get("MMSI") or body.get("UserID") or body.get("UserId")
    if mmsi is None:
        return
    mmsi_s = str(mmsi)
    name = (meta.get("ShipName") or body.get("Name") or body.get("ShipName") or "").strip() or None
    true_h = body.get("TrueHeading")
    if true_h in (511, None, 511.0):
        true_h = body.get("Heading")
    now = time.time()
    ship = {
        "mmsi": mmsi_s,
        "name": name,
        "latitude": lat_f,
        "longitude": lon_f,
        "sog": _num(body.get("Sog") if body.get("Sog") is not None else body.get("sog")),
        "cog": _num(body.get("Cog") if body.get("Cog") is not None else body.get("cog")),
        "heading": _num(true_h),
        "navStat": body.get("NavigationalStatus"),
        "timestamp": meta.get("time_utc") or int(now * 1000),
        "provider": "aisstream",
        "_seen": now,
    }
    with _AISSTREAM_LOCK:
        prev = _AISSTREAM["ships"].get(mmsi_s)
        # mantém nome se o PositionReport veio sem ShipName
        if not ship["name"] and prev and prev.get("name"):
            ship["name"] = prev["name"]
        _AISSTREAM["ships"][mmsi_s] = ship
        _AISSTREAM["last_msg"] = now
        if len(_AISSTREAM["ships"]) % 200 == 0:
            _aisstream_prune_locked(now)


def _aisstream_worker(api_key: str, bbox: tuple[float, float, float, float], stop_ev: threading.Event):
    """Thread: mantém WebSocket AISStream e preenche cache de navios."""
    if not HAS_WEBSOCKETS:
        with _AISSTREAM_LOCK:
            _AISSTREAM["error"] = "websockets_not_installed"
            _AISSTREAM["connected"] = False
        return

    west, south, east, north = bbox
    # BoundingBoxes: [[[lat1, lon1], [lat2, lon2]]] — formato oficial aisstream
    boxes = [[[south, west], [north, east]]]

    async def run():
        url = "wss://stream.aisstream.io/v0/stream"
        while not stop_ev.is_set():
            try:
                async with websockets.connect(
                    url, ping_interval=20, ping_timeout=20, close_timeout=5, max_size=2**22
                ) as ws:
                    # Sem FilterMessageTypes: mais tráfego, melhor chance no litoral BR
                    sub = {
                        "APIKey": api_key,
                        "BoundingBoxes": boxes,
                    }
                    await ws.send(json.dumps(sub))
                    with _AISSTREAM_LOCK:
                        _AISSTREAM["connected"] = True
                        _AISSTREAM["error"] = None
                    while not stop_ev.is_set():
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=45)
                        except asyncio.TimeoutError:
                            continue
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(msg, dict):
                            continue
                        if msg.get("error"):
                            with _AISSTREAM_LOCK:
                                _AISSTREAM["error"] = str(msg.get("error"))
                            break
                        # erro de autenticação às vezes vem como text/errorMessage
                        err_txt = msg.get("errorMessage") or msg.get("Error")
                        if err_txt:
                            with _AISSTREAM_LOCK:
                                _AISSTREAM["error"] = str(err_txt)
                            break
                        if msg.get("MessageType") or msg.get("MetaData"):
                            _aisstream_upsert(msg)
            except Exception as exc:  # noqa: BLE001
                with _AISSTREAM_LOCK:
                    _AISSTREAM["connected"] = False
                    _AISSTREAM["error"] = str(exc)
                if stop_ev.wait(4.0):
                    break
        with _AISSTREAM_LOCK:
            _AISSTREAM["connected"] = False

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        with _AISSTREAM_LOCK:
            _AISSTREAM["loop"] = loop
        loop.run_until_complete(run())
    except Exception as exc:  # noqa: BLE001
        with _AISSTREAM_LOCK:
            _AISSTREAM["error"] = str(exc)
            _AISSTREAM["connected"] = False
    finally:
        try:
            loop = _AISSTREAM.get("loop")
            if loop and not loop.is_closed():
                loop.close()
        except Exception:  # noqa: BLE001
            pass


def ensure_aisstream(api_key: str, west: float, south: float, east: float, north: float) -> bool:
    """
    Garante thread AISStream ativa para a chave e bbox.
    Retorna True se a thread foi (re)iniciada agora (primeiro pedido deve esperar mais).
    """
    key = (api_key or "").strip()
    if not key:
        return False
    if not HAS_WEBSOCKETS:
        with _AISSTREAM_LOCK:
            _AISSTREAM["error"] = "websockets_not_installed"
        return False

    west = max(-180.0, min(180.0, west))
    east = max(-180.0, min(180.0, east))
    south = max(-90.0, min(90.0, south))
    north = max(-90.0, min(90.0, north))
    if west > east:
        west, east = east, west
    if south > north:
        south, north = north, south

    stream_bbox = _expand_stream_bbox(west, south, east, north)
    view = (west, south, east, north)

    with _AISSTREAM_LOCK:
        same_key = _AISSTREAM["key"] == key
        old_bbox = _AISSTREAM["bbox"]
        need_restart = not same_key or old_bbox is None
        if old_bbox and not need_restart:
            ow, os_, oe, on_ = old_bbox
            # reinicia se o viewport saiu do bbox do stream (com margem)
            if (
                view[0] < ow + 0.5
                or view[1] < os_ + 0.5
                or view[2] > oe - 0.5
                or view[3] > on_ - 0.5
            ):
                need_restart = True
            # zoom-out grande
            if (view[2] - view[0]) > (oe - ow) * 1.2 or (view[3] - view[1]) > (on_ - os_) * 1.2:
                need_restart = True
        thr = _AISSTREAM["thread"]
        alive = thr is not None and thr.is_alive()
        if alive and not need_restart:
            return False
        if thr and thr.is_alive() and _AISSTREAM["stop"]:
            _AISSTREAM["stop"].set()
        stop_ev = threading.Event()
        if not same_key:
            _AISSTREAM["ships"] = {}
        _AISSTREAM["key"] = key
        _AISSTREAM["bbox"] = stream_bbox
        _AISSTREAM["stop"] = stop_ev
        _AISSTREAM["error"] = None
        _AISSTREAM["started_at"] = time.time()
        t = threading.Thread(
            target=_aisstream_worker,
            args=(key, stream_bbox, stop_ev),
            name="aisstream",
            daemon=True,
        )
        _AISSTREAM["thread"] = t
        t.start()
        return True


def aisstream_ships_in_bbox(west, south, east, north):
    with _AISSTREAM_LOCK:
        _aisstream_prune_locked()
        ships = list(_AISSTREAM["ships"].values())
        err = _AISSTREAM["error"]
        connected = _AISSTREAM["connected"]
        last = _AISSTREAM["last_msg"]
    out = []
    for s in ships:
        lat = s.get("latitude")
        lon = s.get("longitude")
        if lat is None or lon is None:
            continue
        if south <= lat <= north and west <= lon <= east:
            # não vaza campo interno _seen
            out.append({k: v for k, v in s.items() if not str(k).startswith("_")})
    return out, err, connected, last


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"KeClima em http://localhost:{PORT}")
    print("Proxy FIRMS:  /api/firms/hotspots")
    print("Focos unidos: /api/fires/hotspots  (INPE + FIRMS)")
    print("Desmate DETER: /api/deforestation/alerts")
    print("Proxy INMET:  /api/inmet/nearest?lat=&lon=")
    print("Avisos INMET: /api/inmet/alerts?lat=&lon=  (Alert-AS oficiais)")
    print("Voos ao vivo: /api/flights/live?west=&south=&east=&north=  (OpenSky)")
    print("Aeronave:     /api/flights/aircraft?icao24=")
    print("Rota:         /api/flights/route?callsign=")
    print("Navios AIS:   /api/ships/live?west=&south=&east=&north=  (Digitraffic EU + AISStream key)")
    print("  AISStream:  key=... query ou env AISSTREAM_API_KEY  (pip install websockets)")
    print("ISS:          /api/iss/now  (WhereTheISS / Open Notify)")
    print("Terremotos:   /api/earthquakes/live?west=&south=&east=&north=  (USGS)")
    print("EONET:        /api/eonet/events?west=&south=&east=&north=  (NASA eventos naturais)")
    print("Satélite IV:  /api/satellite/goes?sector=ssa|fd|taw  (NOAA GOES IR)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrado.")


if __name__ == "__main__":
    main()
