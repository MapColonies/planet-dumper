# planet-dumper
This cli is responsible for creating an osm dump file (pbf format) representing the current "planet" of an openstreetmap database, meaning a snapshot of all the osm elements in a current time. The dump will be uploaded to a s3 based object storage if configured so and the metadata will be insterted into [dump-server](https://github.com/MapColonies/dump-server).

This is accomplished by using the [planet-dump-ng](https://github.com/zerebubuth/planet-dump-ng) tool against a postgres backup file created with [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

**supports versions 12, 13, 14 and 15 of postgres**

## Usage

The command (first positional argument) selects which pipeline runs — there are no other CLI flags. Every parameter is read from schema-validated config instead (see [Configuration](#configuration) below); nothing here is passed as `--flag`s anymore.

### pg_dump
```
index.js pg_dump
```
Creates a postgres dump from an existing osm database. Uses `OUTPUT_FORMAT`, `STATE_SOURCE`, `CLEANUP_MODE`.

### create
```
index.js create
```
Creates a pbf dump from an osm database, uploads it to S3, and optionally registers it with a dump-server. Uses everything `pg_dump` does, plus `RESUME`, `INFO`, `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACL`, `DUMP_SERVER_ENDPOINT`, `DUMP_SERVER_HEADERS`. `S3_ENDPOINT`/`S3_BUCKET_NAME` are required to run this command.

### schedule
Runs the `create` or `pg_dump` pipeline repeatedly on a cron schedule, in-process (using [node-cron](https://github.com/merencia/node-cron)), instead of exiting after a single run.
```
index.js schedule
```
Uses everything `create`/`pg_dump` use (only the ones relevant to `TARGET` are required), plus `TARGET` (`create` or `pg_dump` — which pipeline runs on each tick), `CRON_EXPRESSION`, and `RUN_ON_INIT`.

A tick is skipped (with a warning logged) if the previous run is still in progress, so runs never overlap. The process shuts down gracefully on `SIGTERM`/`SIGINT`.

## Deployment Modes

- One-shot (`pg_dump`/`create`): for manual or CI-triggered runs, or a Kubernetes `Job`. The process exits after a single run.
- Recurring (`schedule`): for a long-running Kubernetes `Deployment` (a single always-on pod) that schedules its own dumps internally — no external scheduler needed.

## Configuration

Application configuration (as opposed to per-invocation CLI options) is validated against the
[`vector/planetDumper`](https://github.com/MapColonies/schemas) schema via
[`@map-colonies/config`](https://github.com/MapColonies/config). Defaults live in `config/default.json`;
every field's environment variable override is defined on the schema itself (`x-env-value`), so there is
no separate `custom-environment-variables.json` to keep in sync. By default the app runs in offline mode
(reading only the local `config/` files, no config-server dependency) - set `CONFIG_OFFLINE_MODE=false`
and `CONFIG_SERVER_URL` to use a remote config-server instead.

**Env Variables**

Required environment variables (native to `pg_dump`/`psql`, not part of the schema-managed config -
these are read directly by the postgres binaries, not by planet-dumper's own code):

- `PGHOST` - Database host
- `PGDATABASE` - Database name
- `PGUSER` - Database user
- `PGPASSWORD` - Database user's password
- `PGPORT` - Database's port

Optional environment variables:

- `POSTGRES_ENABLE_SSL_AUTH` - flag for enabling postgres certificate auth, defaults to `false`
- `PG_DUMP_VERBOSE` - verbose flag for pg_dump defaults to false
- `NG_DUMP_MAX_CONCURRENCY` - maximum number of disk writing threads to run for *each* table
- `HTTP_CLIENT_TIMEOUT` - http client timeout duration in ms, defaults to 1000ms
- `STATE_SOURCE` - replication state url or a specific state number, defaults to `1`
- `CLEANUP_MODE` - the command execution cleanup mode, one of `none`/`pre-clean-others`/`post-clean-others`/`post-clean-workdir`/`post-clean-all`, defaults to `none`
- `RESUME` - resume an already-existing dump state (used by `create`/`schedule`), defaults to `false`
- `INFO` - collect info on the resulting dump (used by `create`/`schedule`), defaults to `false`
- `S3_ACL` - the canned acl policy for uploaded objects, one of `authenticated-read`/`private`/`public-read`/`public-read-write`, defaults to `private`
- `DUMP_SERVER_ENDPOINT` - the endpoint of the dump-server (used by `create`/`schedule`)
- `DUMP_SERVER_HEADERS` - the headers to attach to the dump-server request, as a JSON array of `key=value` strings, e.g. `["X-API-KEY=secret"]`
- `RUN_ON_INIT` - whether `schedule` runs its pipeline once immediately at startup, in addition to the cron schedule, defaults to `false`

Required if `POSTGRES_ENABLE_SSL_AUTH` is true:

- `POSTGRES_CA_PATH` - path to the root CA certificate file
- `POSTGRES_CERT_PATH` - path to the client certificate file
- `POSTGRES_KEY_PATH` - path to the client certificate key file

Required for every command:

- `OUTPUT_FORMAT` - the resulting dump's output name format, example: `prefix_{state}_{timestamp}_suffix.pbf`

Required to run `create`, or `schedule` with `TARGET=create`:

- `S3_ENDPOINT` - the s3 endpoint
- `S3_BUCKET_NAME` - the bucket the resulting dump will be uploaded to

Required to run `schedule`:

- `TARGET` - which pipeline to run on each tick, `create` or `pg_dump`
- `CRON_EXPRESSION` - a cron expression controlling the tick interval

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
| 107              | invalid state error       | state file located in s3 is invalid.                                            |

## Building and Running

### Build argument variables
- `NODE_VERSION` - the version of node, defaults to 24
- `PLANET_DUMP_NG_TAG` - the version of planet-dump-ng, defaults to v1.2.7
- `POSTGRESQL_VERSION` - the version of postgresql-client to be installed, by default version 15
notice that the postgresql-client version should be determined by your postgresql database version, tested on versions 12, 13, 14 and 15 of postgres.

### Building the container

```
    docker build \
    --build-arg PLANET_DUMP_NG_TAG=v1.2.0 \
    --build-arg POSTGRESQL_VERSION=13 \
    -f ./Dockerfile -t planet-dumper:latest .
```

### Running the container

```
    docker run \
    --env-file .env \
    -t planet-dumper:latest
```
