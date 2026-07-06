# Stateless WeasyPrint HTML->PDF report service (foundation §8).
FROM python:3.12-slim

# WeasyPrint's native rendering deps (Pango/Cairo/GDK-Pixbuf) + a base font.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi8 \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "weasyprint==63.1"

WORKDIR /app
COPY app.py .
EXPOSE 8000
CMD ["python", "app.py"]
