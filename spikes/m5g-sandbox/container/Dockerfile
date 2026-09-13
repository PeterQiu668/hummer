FROM python:3.12-slim-bookworm

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/workspace/.home \
    TMPDIR=/workspace/.tmp \
    MPLCONFIGDIR=/workspace/.matplotlib

COPY requirements.lock /tmp/requirements.lock
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install --yes --no-install-recommends fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --requirement /tmp/requirements.lock \
    && python -c "import docx, jinja2, matplotlib, openpyxl, PIL, pptx" \
    && groupadd --gid 65532 hummer \
    && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin hummer

USER 65532:65532
WORKDIR /workspace

CMD ["python", "--version"]
