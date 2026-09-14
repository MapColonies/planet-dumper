# planet-dumper
A Helm chart for planet-dumper

A cronjob scheduled on every interval for creating a planet dump and uploading it to an object storage

**Values**

- `environment` - the working environment, defaults to `development`
- `cloudProvider.name` - name of the cloud provider. supports `minikube` and `azure`, defaults to `minikube`
- `cloudProvider.dockerRegistryUrl` - the docker image registry url
- `dumpNamePrefix` - the created dump name prefix
- `schedule` - the cronjob schedule interval in the format of [the cron schedule syntax](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/#cron-schedule-syntax)
- `objectStrorageConfig.enableInternal` - enabling an internal object storage chart using [minio](https://artifacthub.io/packages/helm/bitnami/minio)

- `dbConfig.sslAuth.enabled` - enabling postgres certificate auth
- `dbConfig.sslAuth.secretName` - secret name containing the certificates for `cert-conf` volume
- `dbConfig.sslAuth.mountPath` - the path for the mounted certificates
- `dbConfig.sslAuth.certFileName` - cert file name
- `dbConfig.sslAuth.keyFileName` - cert auth key name
- `dbConfig.sslAuth.caFileName` - root cert auth name

**global Values**

- `global.environment` - overrides the value on `environment`
- `global.cloudProvider.name` - overrides the value on `cloudProvider.name`
- `global.cloudProvider.dockerRegistryUrl` - overrides the value on `cloudProvider.dockerRegistryUrl`

**Installing the chart**

```
helm install -f ./helm/myvalues.yaml planet-dumper ./helm
```



**HTTP trigger API examples**

These only apply when the chart is running in `schedule` mode (`cron.enabled: true`). All three endpoints are always available together; none require authentication (see [API.md](../API.md) for the full reference). Reach them through a port-forward first:


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

