# KeClima — estado e deploy

## Estado atual

| Item | Valor |
|------|--------|
| Versão | **0.7.4** |
| Stack | HTML/CSS/JS ES Modules, PWA, sem framework |
| Local | `python3 serve.py 8080` → http://localhost:8080 |
| Cloud | `$PORT` + `python3 serve.py` |
| Deploy | `Procfile`, `render.yaml`, `Dockerfile` |

### Proxies (`serve.py`)

- `/api/fires/hotspots` — INPE + FIRMS
- `/api/inmet/nearest` — estação INMET
- `/api/deforestation/alerts` — DETER
- `/api/flights/*` — OpenSky + metadados
- `/api/ships/live` — Digitraffic + AISStream opcional
- `/api/iss/now` — posição da ISS
- `/api/earthquakes/live` — USGS
- `/api/eonet/events` — NASA EONET
- `/api/satellite/goes` — GOES Clean IR

### Checklist deploy

- [x] Código local + git  
- [x] Arquivos PaaS  
- [ ] GitHub + Render/Railway  
- [ ] Validar health + camadas BR no ar  

## Não reabrir (já resolvido)

- Splash travando  
- Ícone Leaflet quebrado (quadrado)  
- Voos invisíveis (CSS `divIcon`)  
- Painel “Camadas ativas e fontes” removido (pedido)  
- Preparação/survival removido  

Detalhes: `README.md`
