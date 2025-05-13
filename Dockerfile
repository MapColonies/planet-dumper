ARG NODE_VERSION=16

FROM ubuntu:20.04 AS buildPlanetDumpNg

ENV DEBIAN_FRONTEND=noninteractive
ARG PLANET_DUMP_NG_TAG=v1.2.7
WORKDIR /app

RUN apt-get update \
    && apt-get install -y build-essential \
    automake \
    autoconf \
    libxml2-dev \
    libboost-dev \
    libboost-program-options-dev \
    libboost-date-time-dev \
    libboost-filesystem-dev \
    libboost-thread-dev \
    libboost-iostreams-dev \
    libosmpbf-dev \
    osmpbf-bin \
    libprotobuf-dev\
    pkg-config \
    git-core

RUN git clone -b ${PLANET_DUMP_NG_TAG} --single-branch https://github.com/zerebubuth/planet-dump-ng.git ./planet-dump-ng \
  && cd planet-dump-ng \
  && ./autogen.sh \
  && ./configure \
  && make

FROM ubuntu:20.04 AS buildOsmium

ENV DEBIAN_FRONTEND=noninteractive
ARG OSMIUM_TOOL_TAG=v1.16.0
ARG PROTOZERO_TAG=v1.7.1
ARG LIBOSMIUM_TAG=v2.20.0

RUN apt-get -y update && apt -y install \
  make \
  cmake \
  g++ \
  libboost-dev \
  libboost-system-dev \
  libboost-filesystem-dev \
  libboost-program-options-dev \
  libexpat1-dev \
  libbz2-dev \
  libpq-dev \
  libopencv-dev \
  zlib1g-dev \
  git-core

RUN git clone -b ${OSMIUM_TOOL_TAG} --single-branch https://github.com/osmcode/osmium-tool ./osmium-tool && \
  git clone -b ${PROTOZERO_TAG} --single-branch https://github.com/mapbox/protozero ./protozero && \
  git clone -b ${LIBOSMIUM_TAG} --single-branch https://github.com/osmcode/libosmium ./libosmium && \
  cd osmium-tool && \
  mkdir build && \
  cd build && \
  cmake .. && \
  make

FROM node:${NODE_VERSION} as buildApp

WORKDIR /tmp/buildApp

COPY ./package*.json ./

RUN npm install
COPY . .
RUN npm run build

FROM ubuntu:20.04 as production

ENV DEBIAN_FRONTEND=noninteractive
ENV workdir /app
ARG POSTGRESQL_VERSION=15
ARG NODE_VERSION

WORKDIR ${workdir}

COPY --from=buildPlanetDumpNg /app/planet-dump-ng/planet-dump-ng /usr/local/bin
COPY --from=buildOsmium /osmium-tool/build /osmium-tool/build
RUN ln -s /osmium-tool/build/osmium /bin/osmium

RUN apt-get update \
    && apt-get install -y gnupg \
    curl \
    ca-certificates \
    lsb-release \
    libxml2-dev \
    libboost-program-options-dev \
    libboost-filesystem-dev \
    libboost-date-time-dev \
    libboost-thread-dev \
    libboost-iostreams-dev \
    libosmpbf-dev \
    wget \
    && apt-get clean all \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && sh -c "echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main' > /etc/apt/sources.list.d/pgdg.list" \
    && apt-get update \
    && apt-get -y install postgresql-client-${POSTGRESQL_VERSION}

RUN apt-get update \
    && apt-get -y install curl \
    && curl -L https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash \
    && apt-get -y install nodejs libboost-filesystem-dev libpq-dev libproj-dev liblua5.3-dev libboost-program-options-dev

COPY ./package*.json ./

RUN npm ci --only=production

COPY --from=buildApp /tmp/buildApp/dist .
COPY ./config ./config
COPY start.sh .

RUN chgrp root $workdir/start.sh && chmod -R a+rwx $workdir && \
    mkdir /.postgresql && chmod g+w /.postgresql

# uncomment while developing to make sure the docker runs on openshift
# RUN useradd -ms /bin/bash user && usermod -a -G root user
# USER user

ENTRYPOINT [ "/app/start.sh" ]
