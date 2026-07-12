#!/bin/bash
# KeClima – Teste completo de integração de todas as APIs
# Uso: bash scripts/full_api_test.sh [porta]
set -euo pipefail
PORT="${1:-8080}"
BASE="http://localhost:$PORT"
PASS=0
FAIL=0
WARN=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$1"; }

check() {
  local label="$1" url="$2" expect_key="$3"
  local body status
  body=$(curl -s -w "\n__HTTP_STATUS__:%{http_code}" --max-time 30 "$url" 2>&1)
  status=$(echo "$body" | grep '__HTTP_STATUS__:' | sed 's/__HTTP_STATUS__://')
  body=$(echo "$body" | grep -v '__HTTP_STATUS__:')

  if [ "$status" = "200" ]; then
    if [ -n "$expect_key" ]; then
      if echo "$body" | grep -q "$expect_key"; then
        green "✅ $label (HTTP $status, found '$expect_key')"
        PASS=$((PASS + 1))
      else
        yellow "⚠️  $label (HTTP $status, key '$expect_key' NOT found)"
        WARN=$((WARN + 1))
        echo "   Response: $(echo "$body" | head -c 200)"
      fi
    else
      green "✅ $label (HTTP $status)"
      PASS=$((PASS + 1))
    fi
  else
    red "❌ $label (HTTP $status)"
    FAIL=$((FAIL + 1))
    echo "   Response: $(echo "$body" | head -c 200)"
  fi
}

check_cors() {
  local label="$1" url="$2"
  local headers
  headers=$(curl -s -D - -o /dev/null --max-time 10 "$url" 2>&1)
  if echo "$headers" | grep -qi "Access-Control-Allow-Origin"; then
    green "✅ CORS $label"
    PASS=$((PASS + 1))
  else
    red "❌ CORS $label (missing Access-Control-Allow-Origin)"
    FAIL=$((FAIL + 1))
  fi
}

check_options() {
  local label="$1" url="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS --max-time 10 "$url" 2>&1)
  if [ "$status" = "204" ] || [ "$status" = "200" ]; then
    green "✅ OPTIONS $label (HTTP $status)"
    PASS=$((PASS + 1))
  else
    red "❌ OPTIONS $label (HTTP $status)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "================================================"
echo "  KeClima - Teste Completo de Integracao"
echo "  Servidor: $BASE"
echo "================================================"
echo ""

# 1. Health
echo "--- Health ---"
check "Health" "$BASE/api/health" '"ok": true'

# 2. CORS
echo ""
echo "--- CORS ---"
check_cors "Health endpoint" "$BASE/api/health"
check_options "Health preflight" "$BASE/api/health"

# 3. Frontend files
echo ""
echo "--- Frontend ---"
check "index.html" "$BASE/" "KeClima"
check "main.js" "$BASE/src/main.js" "createApp"
check "config.js" "$BASE/src/config.js" "APP_VERSION"
check "leaflet.js" "$BASE/public/vendor/leaflet/leaflet.js" ""
check "main.css" "$BASE/src/styles/main.css" ""

# 4. API - Flights
echo ""
echo "--- Flights API ---"
check "Flights (regional SP)" "$BASE/api/flights/live?west=-47&south=-24&east=-43&north=-22&ground=1" '"flights"'
check_cors "Flights" "$BASE/api/flights/live?west=-47&south=-24&east=-43&north=-22"

# 5. API - Ships
echo ""
echo "--- Ships API ---"
check "Ships (regional)" "$BASE/api/ships/live?west=-47&south=-24&east=-43&north=-22" '"ships"'

# 6. API - ISS
echo ""
echo "--- ISS API ---"
check "ISS position" "$BASE/api/iss/now" '"latitude"'

# 7. API - Earthquakes
echo ""
echo "--- Earthquakes API ---"
check "Earthquakes" "$BASE/api/earthquakes/live?west=-180&south=-90&east=180&north=90" '"earthquakes"'

# 8. API - EONET
echo ""
echo "--- EONET API ---"
check "EONET events" "$BASE/api/eonet/events?limit=5" '"events"'

# 9. API - Fires
echo ""
echo "--- Fires API ---"
check "FIRMS hotspots" "$BASE/api/firms/hotspots?west=-47&south=-24&east=-43&north=-22&days=1" '"hotspots"'

# 10. API - INMET
echo ""
echo "--- INMET API ---"
check "INMET alerts" "$BASE/api/inmet/alerts?lat=-23.55&lon=-46.63" '"alerts"'
check "INMET nearest" "$BASE/api/inmet/nearest?lat=-23.55&lon=-46.63" '"station"'

# 11. API - Deforestation
echo ""
echo "--- Deforestation API ---"
check "DETER alerts" "$BASE/api/deforestation/alerts?west=-55&south=-15&east=-45&north=-5" '"alerts"'

# 12. API - Satellite
echo ""
echo "--- Satellite API ---"
check "GOES satellite" "$BASE/api/satellite/goes?product=clean_ir" '"url"'

# 13. API - Flight details
echo ""
echo "--- Flight Details API ---"
check "Aircraft details" "$BASE/api/flights/aircraft?icao24=a00001" ""
check "Flight route" "$BASE/api/flights/route?callsign=TAM3101" ""

# Summary
echo ""
echo "================================================"
echo "  Resultados"
echo "================================================"
green "  Passou: $PASS"
if [ "$WARN" -gt 0 ]; then
  yellow "  Avisos: $WARN"
fi
if [ "$FAIL" -gt 0 ]; then
  red "  Falhou: $FAIL"
else
  green "  Sem falhas!"
fi
echo "================================================"
echo ""
