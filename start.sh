#!/usr/bin/env bash

POSTGRES_CERTIFICATES_PATH=/.postgresql
CERTIFICATES_UPDATE_PATH=/usr/local/share/ca-certificates

if [ "$POSTGRES_ENABLE_SSL_AUTH" = "true" ]
then
  cp $POSTGRES_CERTS_MOUNT_PATH/* $POSTGRES_CERTIFICATES_PATH
  chmod 400 $POSTGRES_CERTIFICATES_PATH/*.key
fi

if [ "$SHOULD_UPDATE_CA_CERTIFICATES" = "true" ]
then
  if [ "$OBJECT_STORAGE_VERIFY_ROOT_CERT" = "true" ]
  then
    cp $OBJECT_STORAGE_CERT_DIR/* $CERTIFICATES_UPDATE_PATH/root-object-storage.crt
    chmod 644 $CERTIFICATES_UPDATE_PATH/root-object-storage.crt
  fi

  if [ "$DUMP_SERVER_VERIFY_ROOT_CERT" = "true" ]
  then
    cp $DUMP_SERVER_CERT_DIR/* $CERTIFICATES_UPDATE_PATH/root-dump-server.crt
    chmod 644 $CERTIFICATES_UPDATE_PATH/root-dump-server.crt
  fi

  update-ca-certificates
fi

python3 planet-dumper.py
