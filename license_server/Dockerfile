FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV LICENSE_DB_PATH=/data/license_server.db
EXPOSE 8787

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8787}"]
