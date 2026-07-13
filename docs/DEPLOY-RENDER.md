# Deploy KeClima no Render

O KeClima **não é só estático**: precisa de `serve.py` (proxies INMET, FIRMS/INPE, DETER, voos, AIS, ISS, USGS, EONET e GOES).

## Produção atual

| | |
|--|--|
| **Site** | https://keclima.onrender.com |
| **Health** | https://keclima.onrender.com/api/health |
| **Repo** | https://github.com/kcristtiannlp/keclima |
| **Plano** | Free (cold start após inatividade) |

Cada `git push` na branch `main` pode disparar um novo deploy automático no Render (se Auto-Deploy estiver ligado).

---

## Como foi configurado (referência)

### 1. Código no GitHub

```bash
cd ~/keclima
# remote já existe:
# git remote -v  →  origin https://github.com/kcristtiannlp/keclima.git
git push -u origin main
```

### 2. Web Service no Render

**New → Web Service** → repo `kcristtiannlp/keclima`:

| Campo | Valor |
|-------|--------|
| Name | `keclima` |
| Language | Python 3 |
| Branch | `main` |
| Root Directory | *(vazio)* |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `python3 serve.py` |
| Instance | **Free** |

> Não use o padrão `gunicorn your_application.wsgi` — o KeClima sobe com `serve.py`.

Opcional (Blueprint): `render.yaml` no repositório.

### 3. Validar

| URL | Esperado |
|-----|----------|
| https://keclima.onrender.com/api/health | `{"ok":true,"version":"0.8.13",...}` |
| https://keclima.onrender.com/ | App KeClima |
| Dashboard → INMET / focos / desmate | Dados BR (podem demorar no cold start) |

### 4. Domínio próprio (opcional)

Render → Settings → Custom Domain → CNAME no DNS → aguardar SSL.

## Variáveis de ambiente (opcionais)

| Nome | Uso |
|------|-----|
| `PORT` | Injetada pelo Render — não precisa criar |
| `OPENSKY_USERNAME` / `OPENSKY_PASSWORD` | Melhor cota OpenSky |
| `AISSTREAM_API_KEY` | AIS global de navios |

## Notas

- Free: dorme após inatividade; 1ª request ~30–60+ s.
- Não use **Static Site** — perde proxies.
- Health check útil: `/api/health`

## Alternativas

- **Railway:** Deploy from GitHub → start `python3 serve.py` (`Procfile` ajuda).
- **Docker:** `docker build -t keclima . && docker run -p 8080:8080 keclima`
