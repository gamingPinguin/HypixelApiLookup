FROM python:3.12-slim

WORKDIR /app
COPY index.html bazaar-tracker.html auction-tracker.html flips.html privacy.html ./
COPY src/ ./src/
COPY backend/ ./backend/
RUN mkdir -p /data

ENV LEDGER_DB=/data/ledger.db
WORKDIR /app/backend
EXPOSE 8080

# one small container, two processes: the collector writes, the server reads.
CMD ["sh", "-c", "python collector.py & exec python server.py"]
