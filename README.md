# planet-dumper
This cli is responsible for creating an osm dump file (pbf format) representing the current "planet" of an openstreetmap database, meaning a snapshot of all the osm elements in a current time. The dump will be uploaded to a s3 based object storage if configured so and the metadata will be insterted into [dump-server](https://github.com/MapColonies/dump-server).

This is accomplished by using the [planet-dump-ng](https://github.com/zerebubuth/planet-dump-ng) tool against a postgres backup file created with [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

**supports versions 12 and 13 of postgres**

## Usage

```
index.js create

create a pbf dump from an osm database

Options:
      --version                             Show version number        [boolean]
  -h, --help                                Show help                  [boolean]
  -e, --s3Endpoint, --s3-endpoint           The s3 endpoint  [string] [required]
  -b, --s3BucketName, --s3-bucket-name      The bucket name containing the state
                                            and the lua script
                                                             [string] [required]
  -a, --s3Acl, --s3-acl                     The canned acl policy for uploaded
                                            objects
  [choices: "authenticated-read", "private", "public-read", "public-read-write"]
                                                            [default: "private"]
  -s, --dumpServerEndpoint,                 The endpoint of the dump-server
  --dump-server-endpoint                                                [string]
      --dumpServerToken, --tkn,             The token of the dump-server used
      --dump-server-token                   for upload                  [string]
  -n, --dumpName, --dump-name               The result dump name
                                                             [string] [required]
  -p, --dumpNamePrefix, --dump-name-prefix  The result dump name prefix [string]
  -t, --dumpNameTimestamp,                  Add timestamp to the resulting dump
  --dump-name-timestamp                     name      [boolean] [default: false]
```

## Cli Environment Variables

Any option that can be set using the cli command line, can be also set by writing its value in `SNAKE_CASE`.
For example, the option `--s3-bucket-name` can be set by using the `S3_BUCKET_NAME` environment variables.

## Configuration

**Env Variables**

Required environment variables:

- `PGHOST` - Database host
- `PGDATABASE` - Database name
- `PGUSER` - Database user
- `PGPASSWORD` - Database user's password
- `PGPORT` - Database's port
- `POSTGRES_ENABLE_SSL_AUTH` - flag for enabling postgres certificate, auth set as 'true' for enabling any other value will be falsy

Optional environment variables:

- `PG_DUMP_VERBOSE` - verbose flag for pg_dump defaults to false
- `HTTP_CLIENT_TIMEOUT` - http client timeout duration in ms, defaults to 1000ms

Required if `POSTGRES_ENABLE_SSL_AUTH` is true:

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
| 103              | s3 bucket not exist       | the given bucket name does not exist on the object storage.                     |
| 104              | object key already exists | the created dump has an object key which does already exist on the bucket.      |
| 105              | remote service response error | remote service responded with an error.                                     |
| 106              | remote service unavailable    | could not reach to remote service.                                          |

## Building and Running

### Build argument variables
- `NODE_VERSION` - the version of node, defaults to 14.
- `PLANET_DUMP_NG_VERSION` - the version of planet-dump-ng, defaults to v1.2.3
- `POSTGRESQL_VERSION` - the version of postgresql-client to be installed, by default version 13.
notice that the postgresql-client version should be determined by your postgresql database version, support is only for versions 12 and 13 of postgres.

### Building the container

```
    docker build \
    --build-arg PLANET_DUMP_NG_VERSION=v1.2.0 \
    --build-arg POSTGRESQL_VERSION=13 \
    -f ./Dockerfile -t planet-dumper:latest .
```

### Running the container

```
    docker run \
    --env-file .env \
    -t planet-dumper:latest
```
