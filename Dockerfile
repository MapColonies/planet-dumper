FROM ubuntu:20.04 AS builder
ARG PLANET_DUMP_NG_VERSION=1.2.0
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# planet-dump-ng
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
    curl

RUN curl -L -o planet-dump-ng.tgz "https://github.com/zerebubuth/planet-dump-ng/archive/v$PLANET_DUMP_NG_VERSION.tar.gz" \
  && tar xzf planet-dump-ng.tgz \
  && rm -f planet-dump-ng.tgz \
  && mv planet-dump-ng-$PLANET_DUMP_NG_VERSION planet-dump-ng \
  && cd planet-dump-ng \
  && ./autogen.sh \
  && ./configure \
  && make

FROM ubuntu:20.04
ARG POSTGRESQL_VERSION=13
ENV DEBIAN_FRONTEND=noninteractive

COPY --from=builder /app/planet-dump-ng/planet-dump-ng /usr/local/bin

# postgresql-client & planet-dump-ng dependencies
RUN apt-get update \
    && apt-get install -y lsb-release \
    libboost-filesystem-dev \
    libboost-program-options-dev \
    libboost-date-time-dev \
    libboost-thread-dev \
    libboost-iostreams-dev \
    libosmpbf-dev \
    wget \
    gnupg2 \
    python3-pip \
    && apt-get clean all \
    && sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
    && apt-get update \
    && apt-get -y install postgresql-$POSTGRESQL_VERSION

ENV workdir /app
WORKDIR $workdir
COPY ./requirements.txt .
RUN pip3 install -r requirements.txt
COPY start.py .
RUN chmod a+x $workdir/start.py


RUN useradd -ms /bin/bash user && usermod -a -G root user
RUN chmod -R a+rwx $workdir

USER user

CMD ./start.py