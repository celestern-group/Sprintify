import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageBackend, StorageListPage, StoredObject } from "./types";

export type S3BackendConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional custom endpoint for S3-compatible stores (R2, MinIO, …). */
  endpoint?: string;
};

/**
 * S3 / S3-compatible storage. Bytes are streamed in and out of the bucket; the
 * bucket name, endpoint and credentials never leave this module — callers only
 * ever deal in opaque keys, and objects are served to browsers through our own
 * authenticated proxy route, so no bucket URL is ever exposed.
 */
export class S3StorageBackend implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3BackendConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      // Path-style addressing is required by most self-hosted / non-AWS
      // S3-compatible endpoints (MinIO, some R2 setups).
      forcePathStyle: Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Belt-and-braces: objects are private regardless of bucket ACL policy.
        ACL: "private",
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      const body = await result.Body.transformToByteArray();
      return { body, contentType: result.ContentType };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async copy(fromKey: string, toKey: string) {
    // CopySource is a URL path, so each segment is encoded but the separators
    // stay literal — encoding the whole string would hide the key's structure
    // from S3 and break any key containing a slash.
    const source = [this.bucket, ...fromKey.split("/")]
      .map(encodeURIComponent)
      .join("/");
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: toKey,
        CopySource: source,
        ACL: "private",
      }),
    );
  }

  async list(options?: {
    prefix?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<StorageListPage> {
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: options?.prefix || undefined,
        MaxKeys: options?.limit ?? 50,
        // S3 returns keys in ascending order, so "start after the last key of
        // the previous page" is a stable cursor across both backends. A
        // ContinuationToken would be opaque and bucket-specific.
        StartAfter: options?.cursor || undefined,
      }),
    );

    return {
      objects: (result.Contents ?? [])
        .filter((entry): entry is typeof entry & { Key: string } =>
          Boolean(entry.Key),
        )
        .map((entry) => ({
          key: entry.Key,
          size: entry.Size ?? 0,
          lastModified: entry.LastModified ?? null,
        })),
      cursor: result.IsTruncated
        ? ((result.Contents ?? []).at(-1)?.Key ?? null)
        : null,
    };
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
