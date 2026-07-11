# KeClima

PWA de meteorologia e território (Brasil): clima, qualidade do ar, mapa, focos de fogo e desmatamento.

**Versão 0.5.0** · HTML/CSS/JS ES Modules · sem React/Vue/Angular

## Executar

```bash
cd keclima
python3 serve.py 8080
# http://localhost:8080
```

> Use **`serve.py`** (proxy para FIRMS, INMET, DETER, OpenSky).  
> `python3 -m http.server` só serve arquivos estáticos — camadas oficiais falham por CORS.

Variáveis úteis:

| Variável | Uso |
|----------|-----|
| `PORT` | Porta HTTP (Render/Railway/Fly usam isso). Padrão `8080`. |

## Deploy (site completo na internet)

O app precisa do **proxy Python** (`serve.py`) para focos unificados, INMET e DETER.

### Opção preferida — Render / Railway / Fly.io

1. Suba o repositório no GitHub (ou conecte a pasta).
2. **Render:** Blueprint com `render.yaml`, ou Web Service com:
   - Build: _(vazio / `true`)_
   - Start: `python3 serve.py`
   - Health: `/api/health`
3. **Railway / Heroku-like:** usa `Procfile` (`web: python3 serve.py`).
4. Aponte o domínio e confira: clima + focos + INMET + DETER.

### Hostinger

- **VPS** com Python + `serve.py` (systemd) + Nginx + SSL.
- Hospedagem **só estática** perde proxies (demo parcial).

Detalhes e checklist: [`docs/ESTADO-E-DEPLOY.md`](docs/ESTADO-E-DEPLOY.md).

## O que tem

| Módulo | Conteúdo |
|--------|----------|
| Clima | Open-Meteo (previsão, UV, vento, etc.) |
| Ar | Open-Meteo Air Quality |
| Observado BR | INMET (estação mais próxima) |
| Mapa | OSM + **satélite óptico (Esri)** + radar/IV + camadas |
| Focos | INPE Queimadas + NASA FIRMS (cruzados) |
| Desmate | INPE DETER + PRODES (TerraBrasilis) |
| Voos | OpenSky + metadados aeronave (proxy) |
| Preparação | Ameaças + kits de sobrevivência offline |
| UI | Painéis S/M/L, personalizar, temas, pt/en/es, PWA |

## Uso rápido

1. Busque a cidade (ex.: **Cachoeira do Campo**) ou use 📍  
2. **Personalizar painéis** — incluir mapa, desmate, etc.; tamanho **P/M/G**  
3. Mapa → **Satélite (imagem)** para base tipo Google Earth  
4. **Focos (INPE+FIRMS)** e **DETER** conforme interesse  

## Performance

- App ~**1 MB** no disco; libs locais em `public/vendor/`  
- Dashboard enxuto por padrão  
- Rotas e camadas sob demanda  
- Toasts só em erro/avisos importantes  

## Testes

```
http://localhost:8080/tests/runner.html
```

Health: `http://localhost:8080/api/health`

Smoke test (sobe o servidor e valida rotas):

```bash
bash scripts/smoke_test.sh
```

Docker (opcional):

```bash
docker build -t keclima .
docker run --rm -p 8080:8080 keclima
```

Guia Render: [`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md)

## Estrutura

```
keclima/
├── serve.py                 # HTTP + proxies
├── Procfile / render.yaml   # deploy PaaS
├── Dockerfile
├── scripts/smoke_test.sh
├── index.html
├── service-worker.js
├── public/vendor/           # Leaflet + Chart.js
└── src/
    ├── pages/ widgets/ components/
    ├── api/providers/ services/ storage/
    └── utils/ styles/
```

## Fontes e limites

- Previsão = modelo (Open-Meteo), não estação  
- INMET/DETER/focos = satélite/estação; não substituem órgãos de emergência  
- Em risco: INMET, Defesa Civil, canais oficiais  

## Licença

MIT — `LICENSE`
