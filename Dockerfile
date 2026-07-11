# KeClima — imagem mínima com proxy Python (stdlib only)
FROM python:3.12-slim

WORKDIR /app
COPY . .

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${PORT}/api/health')" || exit 1

CMD ["python3", "serve.py"]
