FROM python:3.12-slim

WORKDIR /app
COPY ledger.html ./
COPY backend/ ./backend/
RUN mkdir -p /data

ENV LEDGER_DB=/data/ledger.db
WORKDIR /app/backend
EXPOSE 8080

# one small container, two processes: the collector writes, the server reads.
CMD ["sh", "-c", "python collector.py & exec python server.py"]
