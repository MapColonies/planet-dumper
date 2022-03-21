ARG NODE_VERSION=14

FROM ubuntu:20.04 AS buildPlanetDumpNg

ENV DEBIAN_FRONTEND=noninteractive
ARG PLANET_DUMP_NG_TAG=v1.2.3
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

FROM node:${NODE_VERSION} as buildApp

WORKDIR /tmp/buildApp

COPY ./package*.json ./

RUN npm install
COPY . .
RUN npm run build

FROM ubuntu:20.04 as production

ENV DEBIAN_FRONTEND=noninteractive
ENV workdir /app
ARG POSTGRESQL_VERSION=13
ARG NODE_VERSION

WORKDIR ${workdir}

COPY --from=buildPlanetDumpNg /app/planet-dump-ng/planet-dump-ng /usr/local/bin

RUN apt-get update \
    && apt-get install -y gnupg \
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
    && sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
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

RUN chgrp root $workdir/start.sh && chmod -R a+rwx $workdir

# uncomment while developing to make sure the docker runs on openshift
# RUN useradd -ms /bin/bash user && usermod -a -G root user
# USER user

ENTRYPOINT [ "/app/start.sh" ]
