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
- `dbConfig.sslAuth.path` - the path for the certificates
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
