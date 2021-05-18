# planet-dumper
This container is responsible for creating an osm dump file (pbf format) representing the current "planet" of an openstreetmap database, meaning a snapshot of all the osm elements in a current time. the dump will be uploaded to a s3 based object storage if configured so.

This is accomplished by using the [planet-dump-ng](https://github.com/zerebubuth/planet-dump-ng) tool against a postgres backup file created with [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

**supports versions 12 and 13 of postgres**

## Configuration

**Env Variables**

Required environment variables:

- `POSTGRES_HOST` - Database host
- `POSTGRES_DB` - Database name
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database user's password
- `POSTGRES_PORT` - Database's port
- `SHOULD_UPDATE_CA_CERTIFICATES` - Whether to update the root certificates used by the object storage and the dump server on run time

Optional environment variables:

- `DUMP_NAME_PREFIX` - a prefix for the created dump name. dump will be named as `<DUMP_NAME_PREFIX>_<TIMESTAMP_UTC>.pbf` if not given it will be named as `<TIMESTAMP_UTC>.pbf`
- `UPLOAD_TO_OBJECT_STORAGE` - flag for enabling object storage, set as 'true' for enabling any other value will be falsy
- `UPLOAD_TO_DUMP_SERVER` - flag for enabling dump-server dump metadata uploading, set as 'true' for enabling any other value will be falsy
- `POSTGRES_ENABLE_SSL_AUTH` - flag for enabling postgres certificate, auth set as 'true' for enabling any other value will be falsy
- `OBJECT_STORAGE_USE_SSL` - Whether or not to use SSL, defaults to false
- `OBJECT_STORAGE_VERIFY_ROOT_CERT` - Whether or not to verify SSL root certificate, defaults to false
- `DUMP_SERVER_VERIFY_ROOT_CERT` - Whether or not to verify SSL root certificate, defaults to false

Required if `UPLOAD_TO_OBJECT_STORAGE` is true:

- `OBJECT_STORAGE_HOST` - Object Storage's host
- `OBJECT_STORAGE_PORT` - Object Storage's port
- `OBJECT_STORAGE_PROTOCOL` - Object Storage's protocol
- `OBJECT_STORAGE_ACCESS_KEY_ID` - Object Storage's access key id
- `OBJECT_STORAGE_SECRET_ACCESS_KEY` - Object Storage's secret access key
- `OBJECT_STORAGE_BUCKET` - Object Storage's Bucket's name

Required if `UPLOAD_TO_OBJECT_STORAGE` and `OBJECT_STORAGE_VERIFY_ROOT_CERT` are true:
- `OBJECT_STORAGE_CERT_DIR` - the directory path for object storage root certificate used for verification when `OBJECT_STORAGE_VERIFY_ROOT_CERT` is true
- `OBJECT_STORAGE_CERT_NAME` - the name for object storage root certificate used for verification when `OBJECT_STORAGE_VERIFY_ROOT_CERT` is true

Required if `UPLOAD_TO_DUMP_SERVER` is true:

- `DUMP_SERVER_HOST` - Dump Server's host
- `DUMP_SERVER_PORT` - Dump Server's port
- `DUMP_SERVER_PROTOCOL` - Dump Server's protocol
- `DUMP_SERVER_PATH` - Dump Server's url path for posting a new dump metadata
- `DUMP_SERVER_TOKEN` - Dump Server's secret token needed for dump metadata upload

Required if `UPLOAD_TO_DUMP_SERVER` and `DUMP_SERVER_VERIFY_ROOT_CERT` are true:
- `DUMP_SERVER_CERT_DIR` - the directory path for dump server root certificate used for verification when `DUMP_SERVER_VERIFY_ROOT_CERT` is true.
- `DUMP_SERVER_CERT_NAME` - the name for dump server root certificate used for verification when `DUMP_SERVER_VERIFY_ROOT_CERT` is true.

Required if `POSTGRES_ENABLE_SSL_AUTH` is true:

- `POSTGRES_CERTS_MOUNT_PATH` - path to mounted certs
- `POSTGRES_SSL_CERT` - path to cert file
- `POSTGRES_SSL_KEY` - path to cert auth kay
- `POSTGRES_SSL_ROOT_CERT` - path to root cert

**Exit Codes:**

*Exit codes mapping:*

| Exit Code Number | Name                      | Meaning                                                                         |
|------------------|---------------------------|---------------------------------------------------------------------------------|
| 0                | success                   | the program finished successfuly.                                               |
| 1                | general error             | catchall for general errors.                                                    |
| 100              | pg-dump error             | the program threw an exception raised by pg_dump.                               |
| 101              | planet-dump-ng error      | the program threw an exception raised by planet-dump-ng.                        |
| 102              | s3 general error          | the program threw a general exception raised in the process of uploading to s3. |
| 103              | s3 connection error       | s3 connection error occurred.                                                   |
| 104              | s3 upload error           | s3 upload failed.                                                               |
| 105              | s3 bucket not exist       | the given bucket name does not exist on the object storage.                     |
| 106              | object key already exists | the created dump has an object key which does already exist on the bucket.      |
| 107              | missing env arg           | missing a required environment argument.                                        |
| 108              | dump server upload error  | an error occurred in the process of uploading metadata to the dump-server.      |
| 109              | dump server request error | an error occurred in the process of sending the request to the dump-server.     |

For additional info on given errors read the stderr output stream

## Building and Running

### Build argument variables
- `PLANET_DUMP_NG_VERSION` - the version of planet-dump-ng, by default v1.2.0
- `POSTGRESQL_VERSION` - the version of postgresql-client to be installed, by default version 13.
notice that the postgresql-client version should be determined by your postgresql database version, support is only for versions 12 and 13 of postgres.

### Building the container

```
    docker build \
    --build-arg PLANET_DUMP_NG_VERSION=v1.2.0 \
    --build-arg POSTGRESQL_VERSION=12 \
    -f ./Dockerfile -t planet-dumper:v1 .
```

### Running the container

```
    docker run \
    --env-file .env \
    -t planet-dumper:v1
```
