# Deploy KeClima no Render (passo a passo)

O KeClima **não é só estático**: precisa de `serve.py` (proxies INMET, FIRMS/INPE, DETER, voos, AIS, ISS, USGS, EONET e GOES).

## 1. Subir o código no GitHub

No PC (com git instalado no sistema, se possível):

```bash
cd ~/keclima
git remote add origin https://github.com/SEU_USUARIO/keclima.git
git push -u origin main
```

(Crie o repositório vazio no GitHub antes, sem README.)

## 2. Criar o serviço no Render

1. Entre em [https://render.com](https://render.com) e faça login (GitHub).
2. **New → Blueprint** e selecione o repo (usa `render.yaml`),  
   **ou** **New → Web Service** e preencha:
   - **Runtime:** Python
   - **Build Command:** `true` (nada a instalar)
   - **Start Command:** `python3 serve.py`
   - **Instance:** Free
3. Deploy.

## 3. Validar

Abra no navegador:

| URL | Esperado |
|-----|----------|
| `https://SEU-APP.onrender.com/api/health` | `{"ok":true,"version":"0.8.10",...}` |
| `https://SEU-APP.onrender.com/` | App KeClima |
| Dashboard → focos / INMET / desmate | Dados BR (podem demorar no cold start free) |

## 4. Domínio (opcional)

Render → Settings → Custom Domain → aponte o DNS (CNAME) e aguarde SSL.

## Notas

- Plano **free** dorme após inatividade; a 1ª request pode levar ~30–60s.
- Variável `PORT` é injetada pelo Render — `serve.py` já lê.
- Não use “Static Site” no Render: perde os proxies.

## Alternativas

- **Railway:** New Project → Deploy from GitHub → start `python3 serve.py` (`Procfile` ajuda).
- **Docker:** `docker build -t keclima . && docker run -p 8080:8080 keclima`
- **VPS Hostinger:** ver `ESTADO-E-DEPLOY.md` (systemd + Nginx).
