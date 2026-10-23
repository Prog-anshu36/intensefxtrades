FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY dataset-package ./dataset-package
COPY scripts/dataset_package.py ./scripts/dataset_package.py
COPY backend/xauusd_data_provider.py ./backend/xauusd_data_provider.py
RUN python scripts/dataset_package.py restore
RUN python -c "from backend.xauusd_data_provider import LocalXAUUSDDataProvider; LocalXAUUSDDataProvider(cache_dir='/app/prebuilt-cache').ensure_index()"
COPY . .
ENV PORT=5050
EXPOSE 5050
CMD ["python", "scripts/start_hosted.py"]
