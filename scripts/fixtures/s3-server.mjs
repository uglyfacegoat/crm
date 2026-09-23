import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

// Compatibility fixture only, not a recommendation to deploy this archived MinIO release.
const image = "quay.io/minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e";

export async function startS3Fixture({ publishAppPort = false } = {}) {
  const name = `crm-s3-test-${randomUUID()}`;
  const accessKeyId = randomBytes(16).toString("hex");
  const secretAccessKey = randomBytes(32).toString("hex");
  let created = false;
  let client;
  const close = async () => {
    client?.destroy();
    if (created) {
      execFileSync("docker", ["rm", "--force", name], { stdio: "ignore" });
      created = false;
    }
  };
  try {
    execFileSync("docker", ["run", "--detach", "--name", name, "--add-host", "host.docker.internal:host-gateway", "--publish", "127.0.0.1::9000", ...(publishAppPort ? ["--publish", "127.0.0.1::3000"] : []), "--tmpfs", "/data:rw,size=128m", "--env", "MINIO_ROOT_USER", "--env", "MINIO_ROOT_PASSWORD", image, "server", "/data"], {
      env: { ...process.env, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey }, stdio: "ignore",
    });
    created = true;
    const [container] = JSON.parse(execFileSync("docker", ["inspect", name], { encoding: "utf8" }));
    const port = container.NetworkSettings.Ports["9000/tcp"][0].HostPort;
    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { ready = (await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(1000) })).ok; }
      catch { /* Startup may not yet be listening; final readiness failure is explicit. */ }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, "Isolated S3 fixture failed to become ready");
    const bucket = `crm-test-${randomUUID()}`;
    client = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return {
      client, bucket, endpoint, close, containerName: name,
      appEndpoint: publishAppPort ? `http://127.0.0.1:${container.NetworkSettings.Ports["3000/tcp"][0].HostPort}` : undefined,
      environment: {
        DOCUMENT_STORAGE_BACKEND: "s3", DOCUMENT_S3_ENDPOINT: endpoint, DOCUMENT_S3_REGION: "us-east-1",
        DOCUMENT_S3_BUCKET: bucket, DOCUMENT_S3_ACCESS_KEY_ID: accessKeyId, DOCUMENT_S3_SECRET_ACCESS_KEY: secretAccessKey,
        DOCUMENT_S3_FORCE_PATH_STYLE: "true", DOCUMENT_S3_ALLOW_LOCAL_HTTP: "true", DOCUMENT_S3_TIMEOUT_MS: "3000",
      },
    };
  } catch (error) { await close(); throw error; }
}
