#!/usr/bin/env bash

CERTIFICATES_UPDATE_PATH=/usr/local/share/ca-certificates

if [ "$POSTGRES_ENABLE_SSL_AUTH" = "true" ]
then
  cp /tmp/certs-postgres/* $POSTGRES_CERTIFICATES_PATH
  chmod 400 $POSTGRES_CERTIFICATES_PATH/*.key
fi

if [ "$SHOULD_UPDATE_CA_CERTIFICATES" = "true" ]
then
  if [ "$OBJECT_STORAGE_VERIFY_ROOT_CERT" = "true" ]
  then
    cp /tmp/certs-object-storage/* $CERTIFICATES_UPDATE_PATH/root-object-storage.crt
  fi

  if [ "$DUMP_SERVER_VERIFY_ROOT_CERT" = "true" ]
  then
    cp /tmp/certs-dump-server/* $CERTIFICATES_UPDATE_PATH/root-dump-server.crt
  fi

  update-ca-certificates
fi

python3 planet-dumper.py
