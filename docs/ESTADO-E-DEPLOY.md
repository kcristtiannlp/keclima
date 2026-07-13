# KeClima — estado e deploy

## Estado atual

| Item | Valor |
|------|--------|
| Versão | **0.8.10** |
| Stack | HTML/CSS/JS ES Modules, PWA, sem framework |
| Local | `python3 serve.py 8080` → http://localhost:8080 |
| **Produção** | **https://keclima.onrender.com** |
| Health | https://keclima.onrender.com/api/health |
| Código | https://github.com/kcristtiannlp/keclima |
| PaaS | Render · Web Service · plano Free |
| Start | `python3 serve.py` (lê `$PORT`) |
| Build | `pip install -r requirements.txt` |
| Commit live | `cda4aa8` (deploy inicial 2026-07-13) |

### Proxies (`serve.py`)

- `/api/fires/hotspots` — INPE + FIRMS
- `/api/inmet/nearest` — estação INMET
- `/api/inmet/alerts` — avisos oficiais Alert-AS
- `/api/deforestation/alerts` — DETER
- `/api/flights/*` — ADSB.lol + OpenSky (fallback) + metadados
- `/api/ships/live` — Digitraffic + AISStream opcional
- `/api/iss/now` — posição da ISS
- `/api/earthquakes/live` — USGS
- `/api/eonet/events` — NASA EONET
- `/api/satellite/goes` — GOES Clean IR

### Checklist deploy

- [x] Código local + git
- [x] Arquivos PaaS (`Procfile`, `render.yaml`, `Dockerfile`)
- [x] GitHub: https://github.com/kcristtiannlp/keclima
- [x] Render: https://keclima.onrender.com
- [x] Health + proxies no ar (validado 2026-07-13)
  - health `ok` / versão `0.8.10`
  - INMET nearest (SP) OK
  - focos, ISS, GOES OK

### Validação rápida (produção)

```bash
curl -sS https://keclima.onrender.com/api/health
curl -sS "https://keclima.onrender.com/api/inmet/nearest?lat=-23.55&lon=-46.63"
```

## Notas do plano free

- O serviço **dorme** após inatividade; a 1ª request pode levar ~50 s ou mais.
- Não usar “Static Site” no Render — perde os proxies.

## Não reabrir (já resolvido)

- Splash travando
- Ícone Leaflet quebrado (quadrado)
- Voos invisíveis (CSS `divIcon`)
- Painel “Camadas ativas e fontes” removido (pedido)
- Preparação/survival removido
- Deploy cloud (GitHub + Render)

Detalhes: `README.md` · guia Render: `docs/DEPLOY-RENDER.md`
