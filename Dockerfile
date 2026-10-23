FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python scripts/dataset_package.py restore
ENV PORT=5050
EXPOSE 5050
CMD ["sh", "-c", "exec gunicorn --workers 1 --threads 8 --timeout 300 --bind 0.0.0.0:${PORT:-5050} backend.app:app"]
