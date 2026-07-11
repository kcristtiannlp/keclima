# KeClima

PWA de meteorologia e território (Brasil): clima, qualidade do ar, mapa, focos de fogo e desmatamento.

**Versão 0.6.0** · HTML/CSS/JS ES Modules · sem React/Vue/Angular

## Executar

```bash
cd keclima
python3 serve.py 8080
# http://localhost:8080
```

> Use **`serve.py`** (proxy para FIRMS, INMET, DETER, OpenSky).  
> `python3 -m http.server` só serve arquivos estáticos — camadas oficiais falham por CORS.

| Variável | Uso |
|----------|-----|
| `PORT` | Porta HTTP (PaaS). Padrão `8080`. |

## O que tem

| Módulo | Conteúdo |
|--------|----------|
| Clima | Open-Meteo (previsão, UV, vento, etc.) |
| Ar | Open-Meteo Air Quality |
| Observado BR | INMET (estação mais próxima) |
| Mapa | OSM, Carto, OpenTopo, satélite/topo Esri, radar RainViewer |
| Focos | INPE Queimadas + NASA FIRMS (filtros) |
| Desmate | INPE DETER + PRODES |
| Voos | OpenSky (proxy) |
| UI | Painéis S/M/L, temas, pt/en/es, PWA offline |

## Testes

```bash
bash scripts/smoke_test.sh
# ou
http://localhost:8080/tests/runner.html
```

Health: `http://localhost:8080/api/health`

## Deploy

Ver [`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md) e [`docs/ESTADO-E-DEPLOY.md`](docs/ESTADO-E-DEPLOY.md).

```bash
# Docker
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
    ├── pages/ widgets/      # UI
    ├── services/ storage/   # clima, cache, settings
    ├── data/mapCatalog.js   # catálogo de fontes do mapa
    └── styles/main.css
```

## Licença

MIT — `LICENSE`
