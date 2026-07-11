# KeClima — estado e deploy

Notas de desenvolvimento. Resumo para retomar o trabalho sem reler o chat.

## Estado atual

| Item | Valor |
|------|--------|
| Versão | **0.5.0** |
| Stack | HTML/CSS/JS ES Modules, PWA, sem framework |
| Servidor local | `python3 serve.py 8080` → http://localhost:8080 |
| Porta em cloud | `PORT` do ambiente (fallback 8080) |
| Tamanho | ~1 MB (front + vendor locais) |
| Deploy files | `Procfile`, `render.yaml`, `runtime.txt`, `requirements.txt` |

### O que depende do `serve.py` (proxy)

Sem o proxy, o site abre, mas **perde** recursos importantes:

- Focos unificados **INPE Queimadas + NASA FIRMS** (`/api/fires/hotspots`)
- Estação **INMET** mais próxima (`/api/inmet/nearest`)
- Alertas **DETER** desmatamento (`/api/deforestation/alerts`)
- Voos **OpenSky** (`/api/flights/*`)

Clima Open-Meteo, mapa base, gráficos, preparação offline e PWA funcionam também em estático — com menos “produto BR”.

### Destaques de produto já no código

- Mapa: OSM + satélite Esri, radar, nuvens, focos, DETER/PRODES, voos
- Dashboard: personalizar painéis, tamanhos S/M/L (inclui mapa)
- Preparação / kits de sobrevivência (offline)
- Localização: GPS alta precisão + aviso se impreciso; Nominatim prioriza nome local
- Offline PWA com service worker `keclima-v0.5.0`

## Decisão de publicação

**Melhor solução para o site ficar completo na internet:**

1. **Preferido (menos manutenção):** PaaS — **Render**, **Railway** ou **Fly.io**  
   - Rodar: `python3 serve.py` (lê `$PORT`)  
   - HTTPS automático  
   - Domínio próprio (DNS) se quiser  
   - Arquivos prontos: `Procfile`, `render.yaml`

2. **Se ficar na Hostinger:** **VPS** (não hospedagem compartilhada só PHP/HTML)  
   - Python + `serve.py` (systemd) + Nginx + SSL  

3. **Evitar como “versão final”:** só upload estático na Hostinger compartilhada  
   - Demo ok; fogo unificado / INMET / DETER somem ou falham por CORS  

### Checklist deploy (PaaS)

- [ ] Repositório no GitHub (ou upload zip no painel)
- [ ] Criar Web Service / Blueprint (`render.yaml` no Render)
- [ ] Start command: `python3 serve.py`
- [ ] Health check: `/api/health` → `{"ok":true,"version":"0.5.0",...}`
- [ ] Abrir URL pública e validar: clima + focos + INMET + DETER
- [ ] (Opcional) Domínio custom + SSL

### systemd (VPS, exemplo)

```ini
[Unit]
Description=KeClima
After=network.target

[Service]
WorkingDirectory=/opt/keclima
Environment=PORT=8080
ExecStart=/usr/bin/python3 serve.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Nginx: reverse proxy `location /` → `http://127.0.0.1:8080` + Certbot.

## Como rodar de novo (local)

```bash
cd ~/keclima   # ou caminho do projeto
python3 serve.py 8080
```

Health/proxies: `http://localhost:8080/api/health`  
Testes: `http://localhost:8080/tests/runner.html`

## Não reabrir no código (já resolvido)

- Splash que travava no onboarding  
- Zoom do radar RainViewer  
- Nuvens ≠ radar (camadas distintas)  
- Nome de local (distrito vs só município/BH)  
- Fontes BR: INPE+FIRMS, INMET, DETER/PRODES  
- Preparação / survival no SW shell  
- `PORT` de ambiente para PaaS  

Detalhes de uso e estrutura: ver `README.md` na raiz.
