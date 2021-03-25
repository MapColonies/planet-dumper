#!/usr/bin/env bash

if [ "$POSTGRES_ENABLE_SSL_AUTH" = "true" ]
then
  cp /tmp/certs/* $POSTGRES_CERTIFICATES_PATH
  chmod 400 $POSTGRES_CERTIFICATES_PATH/*.key
fi

python3 planet-dumper.py
