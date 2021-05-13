#!/usr/bin/env bash

if [ "$POSTGRES_ENABLE_SSL_AUTH" = "true" ]
then
  cp /tmp/certs/* $POSTGRES_CERTIFICATES_PATH
  chmod 400 $POSTGRES_CERTIFICATES_PATH/*.key
fi

if [ "$OBJECT_STORAGE_VERIFY_ROOT_CERT" = "true" ]
then
  cp /tmp/certs/root* /usr/local/share/ca-certificates/rootCA.crt
fi

python3 planet-dumper.py
