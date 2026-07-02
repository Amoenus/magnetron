FROM python:3.13-alpine

LABEL org.opencontainers.image.title="Magnetron" \
    org.opencontainers.image.description="Small internal web UI and API for sending magnet links to bitmagnet and qBittorrent." \
    org.opencontainers.image.url="https://github.com/Amoenus/magnetron" \
    org.opencontainers.image.documentation="https://github.com/Amoenus/magnetron#readme" \
    org.opencontainers.image.source="https://github.com/Amoenus/magnetron" \
    org.opencontainers.image.vendor="Amoenus" \
    org.opencontainers.image.authors="Amoenus" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.base.name="docker.io/library/python:3.13-alpine"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY src/ /app/

USER 1000:1000

EXPOSE 8080

CMD ["python", "-m", "magnetron.app"]
