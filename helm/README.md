# planet-dumper
A Helm chart for planet-dumper

A cronjob scheduled on every interval for creating a planet dump and uploading it to an object storage

**Values**

- `schedule` - the cronjob schedule interval
- `enableInternalObjectStorage` - enabling an internal object storage chart using [minio](https://artifacthub.io/packages/helm/bitnami/minio)

**Installing the chart**

```
helm install -f ./helm/myvalues.yaml planet-dumper ./helm
```