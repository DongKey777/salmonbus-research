# Analysis sandbox image. Built offline: the base image is pinned by digest and already local, the build runs with
# --network none, and Python packages come only from the pinned local wheels (pip --no-index --require-hashes).
# Wheels and the libgomp1 .deb are bind-mounted for the install step only, so they do not become an image layer.
# --no-deps: the lock is the full closure; xgboost's nvidia-nccl-cu13 requirement is GPU-only and deliberately not installed.
FROM python:3.12-slim@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_INDEX=1
RUN --network=none \
    --mount=type=bind,from=debs,target=/src/debs,readonly \
    --mount=type=bind,from=wheels,target=/src/wheels,readonly \
    --mount=type=bind,source=requirements.lock,target=/src/requirements.lock,readonly \
    set -eu; \
    echo "43e84cb7971d8a4d8870cab6204e998ea4f23ee1339bb0ff556dd881bac82d25  /src/debs/libgomp1_14.2.0-19_arm64.deb" | sha256sum -c -; \
    dpkg -i /src/debs/libgomp1_14.2.0-19_arm64.deb; \
    pip install --no-index --no-deps --require-hashes --only-binary=:all: --find-links /src/wheels -r /src/requirements.lock; \
    python -c "import numpy, pyarrow, pyarrow.parquet, scipy, xgboost; print(numpy.__version__, pyarrow.__version__, scipy.__version__, xgboost.__version__)"; \
    pip uninstall -y pip; \
    rm -rf /root/.cache /var/cache/* /var/log/*
COPY output_policy.py lab_api.py entry.py /opt/lab/
RUN python -m compileall -q /opt/lab \
    && echo /opt/lab > /usr/local/lib/python3.12/site-packages/autoloop_lab.pth \
    && chmod -R a+rX,go-w /opt/lab
USER 65534:65534
WORKDIR /tmp
CMD ["python", "-I", "-B", "/opt/lab/entry.py"]
