services:
  pocketbase:
    build:
      context: .
      args:
        # Зафиксируйте версию, чтобы избежать неожиданных обновлений
        PB_VERSION: "0.36.6"
    container_name: pocketbase
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      # Данные (SQLite, загрузки) сохраняются на хосте
      - ./pb_data:/pb/pb_data
      # (Опционально) JS-хуки
      # - ./pb_hooks:/pb/pb_hooks
      # (Опционально) Миграции
      # - ./pb_migrations:/pb/pb_migrations
    environment:
      # Ограничение памяти полезно для слабых серверов
      - GOMEMLIMIT=512MiB
    ulimits:
      nofile:
        soft: 4096
        hard: 4096