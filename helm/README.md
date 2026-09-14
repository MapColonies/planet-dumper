# planet-dumper
A Helm chart for planet-dumper

Deploys either a one-shot `Job` (`pg_dump`/`create`, for manual or CI-triggered runs) or, when `cron.enabled` is set, a long-running singleton `Deployment` running the `schedule` command - an in-process node-cron scheduler plus an on-demand HTTP trigger API - instead of a Kubernetes `CronJob`. Only one of `job.enabled`/`cron.enabled` may be true at a time.

**Values**

- `enabled` - master switch for every resource in this chart, defaults to `true`
- `environment` - the working environment, defaults to `development`
- `cloudProvider.flavor` - name of the cloud provider, e.g. `minikube`/`openshift`/`azure`, defaults to `minikube`
- `cloudProvider.dockerRegistryUrl` - the docker image registry url (unused when `flavor` is `minikube`)
- `image.repository` / `image.tag` - the image to run; `tag` defaults to `v<Chart.appVersion>`
- `job.enabled` - deploy the one-shot `Job` instead of the `schedule` Deployment
- `job.apiVersion` / `job.restartPolicy` / `job.ttlSecondsAfterFinished` / `job.backoffLimit` - standard `Job` spec fields
- `cron.enabled` - deploy the long-running `schedule` Deployment instead of the one-shot `Job`
- `cron.schedule` - the cron expression controlling the tick interval (`CRON_EXPRESSION`)
- `cron.target` - which pipeline runs on each tick, `create` or `pg_dump` (`TARGET`)
- `server.port` - the `schedule` command's HTTP trigger server port (`POST /create`, `POST /pg_dump`, `GET /health`)
- `resources.enabled` / `resources.value` - container resource requests/limits
- `env.*` - logging, tracing, http client timeout, and `pgDump`/`ngDump`/`osmium` verbosity settings
- `postgres.host` / `username` / `password` / `database` / `port` - source database connection
- `postgres.sslAuth.enabled` - enable postgres certificate auth
- `postgres.sslAuth.secretName` - secret mounted as the certs volume
- `postgres.sslAuth.mountPath` - where the secret is mounted
- `postgres.sslAuth.caFileName` / `certFileName` / `keyFileName` - the secret's key names for each cert file, joined with `mountPath` to build `POSTGRES_CA_PATH`/`POSTGRES_CERT_PATH`/`POSTGRES_KEY_PATH`
- `s3.accessKey` / `secretKey` - credentials for the object storage (also usable for a MinIO-style store: its username/password serve as the access/secret key)
- `s3.host` / `port` / `protocol` - combine into `S3_ENDPOINT`
- `s3.bucketName` / `acl` - upload destination bucket and canned ACL
- `s3.upload.concurrency` / `partSize` - parallel multipart upload tuning
- `pvc.enabled` / `pvc.name` - mounts `/workdir` from an **existing** PVC; the chart does not create it
- `cli.command` - which command the one-shot `Job` runs (`pg_dump`/`create`), ignored when `cron.enabled`
- `cli.outputFormat` - the dump's output name format
- `cli.stateSource` - a replication state url, a static sequence number, or a url pointing at this chart's own configured S3 bucket (fetched with the s3 credentials above rather than anonymously)
- `cli.cleanupMode` - one of `none`/`pre-clean-others`/`post-clean-others`/`post-clean-workdir`/`post-clean-all` (see the root [README.md](../README.md) for what each one does)
- `cli.create.resume` / `info` - resume-from-partial and info-collection flags for the `create` pipeline
- `cli.create.dumpServer.*` - optional dump-server registration after a successful `create` run
- `arstotzka.*` - optional Arstotzka mediator integration, disabled by default

**global Values**

- `global.environment` - overrides the value on `environment`
- `global.cloudProvider.flavor` - overrides the value on `cloudProvider.flavor`
- `global.cloudProvider.dockerRegistryUrl` - overrides the value on `cloudProvider.dockerRegistryUrl`

**Installing the chart**

```
helm install -f ./helm/myvalues.yaml planet-dumper ./helm
```



**HTTP trigger API examples**

These only apply when the chart is running in `schedule` mode (`cron.enabled: true`). All three endpoints are always available together; none require authentication. Reach them through a port-forward first:


*Health check*
```bash
curl http://localhost:8080/health
```
Always `200` while the process is up.

*Trigger `pg_dump`* — no body, uses the pod's configured `OUTPUT_FORMAT`, `STATE_SOURCE`, `CLEANUP_MODE`:
```bash
curl -X POST http://localhost:8080/pg_dump
```

*Trigger `create`, using the configured `stateSource`*:
```bash
curl -X POST http://localhost:8080/create
```

*Trigger `create`, pinned to a specific numeric state* (overrides config for just this one run):
```bash
curl -X POST http://localhost:8080/create \
  -H "Content-Type: application/json" \
  -d '{"stateSource": "12"}'
```

*Trigger `create` with an invalid `stateSource`* (confirms the validation path — anything non-numeric in the body is rejected):
```bash
curl -X POST http://localhost:8080/create \
  -H "Content-Type: application/json" \
  -d '{"stateSource": "not-a-number"}'
```

Response codes, same across `/pg_dump` and `/create`:

| Status | Meaning |
|---|---|
| `200` | Run completed successfully |
| `400` | (`/create` only) `stateSource` body value wasn't a plain numeric string |
| `409` | A run (either pipeline) was already in progress — rejected |
| `500` | Run failed — body includes the error message |

