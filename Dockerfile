FROM python:3.13-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY src/ /app/

USER 1000:1000

EXPOSE 8080

CMD ["python", "-m", "magnetron.app"]
