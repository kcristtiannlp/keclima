# KeClima

PWA de meteorologia e território (Brasil): clima, qualidade do ar, mapa, focos de fogo e desmatamento.

**Versão 0.8.11** · HTML/CSS/JS ES Modules · sem React/Vue/Angular

| | |
|--|--|
| **Site (no ar)** | https://keclima.onrender.com |
| **Health** | https://keclima.onrender.com/api/health |
| **Código** | https://github.com/kcristtiannlp/keclima |

> Plano free do Render: após inatividade a 1ª abertura pode levar ~30–60 s.

## Executar local

```bash
cd keclima
python3 serve.py 8080
# http://localhost:8080
```

> Use **`serve.py`** (proxy para FIRMS, INMET, DETER, OpenSky/ADSB.lol, AIS, ISS, USGS, EONET e GOES).  
> `python3 -m http.server` só serve arquivos estáticos — camadas oficiais falham por CORS.

| Variável | Uso |
|----------|-----|
| `PORT` | Porta HTTP (PaaS). Padrão `8080`. |
| `OPENSKY_USERNAME` / `OPENSKY_PASSWORD` | Opcional — credenciais OpenSky (melhor cota). |
| `AISSTREAM_API_KEY` | Opcional — AIS global (navios); sem chave usa Digitraffic (Europa). |

## O que tem

| Módulo | Conteúdo |
|--------|----------|
| Previsão | Open-Meteo — home com agora, 48 h, 10 dias e alertas INMET |
| Ar | Open-Meteo Air Quality |
| Observado BR | INMET (estação mais próxima + avisos Alert-AS) |
| Mapa | OSM, Carto, OpenTopo, satélite/topo Esri, radar RainViewer, SST (GHRSST/GIBS), voos, navios, ISS e riscos |
| Focos | INPE Queimadas + NASA FIRMS (filtros) |
| Desmate | INPE DETER + PRODES |
| Voos | ADSB.lol (principal) + OpenSky (fallback) via proxy |
| Satélite IV | GOES Clean IR (NOAA/NESDIS) em Gráficos → Satélite IV |
| UI | Painéis S/M/L, temas, pt/en/es, PWA offline |

## Testes

```bash
bash scripts/smoke_test.sh
# ou
http://localhost:8080/tests/runner.html
```

Health local: `http://localhost:8080/api/health`

## Deploy

Produção atual: **Render** (Web Service free) → https://keclima.onrender.com

- Guia: [`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md)
- Estado e checklist: [`docs/ESTADO-E-DEPLOY.md`](docs/ESTADO-E-DEPLOY.md)

```bash
# Docker (alternativa)
docker build -t keclima .
docker run --rm -p 8080:8080 keclima
```

## Estrutura

```
keclima/
├── serve.py                 # HTTP + proxies
├── index.html / manifest.json / service-worker.js
├── public/vendor/           # Leaflet + Chart.js (local)
├── scripts/smoke_test.sh
├── docs/
└── src/
    ├── api/providers/       # Open-Meteo, INMET, FIRMS, DETER, OpenSky…
    ├── components/          # Header, Nav, Toast…
    ├── pages/ widgets/      # UI (ForecastHome, Map, …)
    ├── services/ storage/   # clima, cache, settings
    ├── data/mapCatalog.js   # catálogo de fontes do mapa
    └── styles/main.css
```

## Licença

MIT — `LICENSE`
