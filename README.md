# planet-dumper
This container is responsible for creating an osm dump file (pbf format) representing the current "planet" of an openstreetmap database meaning all osm related data: elements, changesets, users, etc and uploading it to a an object storage.

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

Optional environment variables:

- `DUMP_NAME_PREFIX` - a prefix for created dump name. will be named as '<DUMP_NAME_PREFIX>_<TIMESTAMP_UTC>'
- `ENABLE_OBJECT_STORAGE` - flag for enabling object storage, set as 'true' for enabling any other value will be falsy

Required if `ENABLE_OBJECT_STORAGE` is true:

- `OBJECT_STORAGE_HOST` - Object Storage's host
- `OBJECT_STORAGE_PORT` - Object Storage's port
- `OBJECT_STORAGE_PROTOCOL` - Object Storage's protocol
- `OBJECT_STORAGE_ACCESS_KEY_ID` - Object Storage's access key id
- `OBJECT_STORAGE_SECRET_ACCESS_KEY` - Object Storage's secret access key
- `OBJECT_STORAGE_BUCKET` - Object Storage's Bucket's name

**Exit Codes:**

*Exit codes mapping:*

    - success: 0 - the program finished successfuly.
    - general_error: 1 - catchall for general errors.
    - pg_dump_error: 100 - the program threw an exception raised by pg_dump.
    - planet-dump-ng_error: 101 - the program threw an exception raised by planet-dump-ng.
    - s3_general_error: 102 - the program threw a general exception raised in the process of uploading to s3.
    - s3_connection_error: 103 - s3 connection error occurred.
    - s3_upload_error: 104 - s3 upload failed.
    - s3_bucket_not_exist: 105 - the given bucket name does not exist on the object storage.
    - object_key_already_exists: 106 - the created dump has an object key which does already exist on the bucket.
    - missing_env_arg: 107 - missing a required environment argument.

For additional info on given errors read the stderr output stream

## Building and Running

### Build argument variables
- `PLANET_DUMP_NG_VERSION` - the version of planet-dump-ng, by default version 1.2.0
- `POSTGRESQL_VERSION` - the version of postgresql-client to be installed, by default version 13.
notice that the postgresql-client version should be determined by your postgresql database version.

### Building the container

```
    docker build \
    --build-arg PLANET_DUMP_NG_VERSION=1.2.0 \
    --build-arg POSTGRESQL_VERSION=12 \
    -f ./Dockerfile -t planet-dumper:v1 .
```

### Running the container

```
    docker run \
    --env-file .env \
    -t planet-dumper:v1
```