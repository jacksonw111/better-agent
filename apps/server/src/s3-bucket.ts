import { AwsClient } from "aws4fetch";
import type { R2ObjectBody } from "./attachment-store";
import type { MultipartBucket, MultipartPart } from "./knowledge-store";

// S3-protocol implementation of the attachment bucket for non-Workers runtimes
// (k3s/prod). Points at R2's S3 endpoint (or any S3-compatible store): the
// same bucket the Workers deployment reaches through its native binding.
// Also implements the S3 multipart-upload API (create/uploadPart/listParts/
// complete/abort) that the Knowledge Base's resumable uploads run on.

export interface S3BucketConfig {
	accessKeyId: string;
	bucket: string;
	/** e.g. https://<account_id>.r2.cloudflarestorage.com */
	endpoint: string;
	secretAccessKey: string;
}

const OK = 200;
const NOT_FOUND = 404;

// The multipart XML payloads are flat and tiny, so a few top-level regexes
// beat pulling in an XML parser dependency.
const UPLOAD_ID_RE = /<UploadId>([^<]+)<\/UploadId>/;
const PART_BLOCK_RE = /<Part>[\s\S]*?<\/Part>/g;
const PART_NUMBER_RE = /<PartNumber>(\d+)<\/PartNumber>/;
const ETAG_RE = /<ETag>([^<]+)<\/ETag>/;
const SIZE_RE = /<Size>(\d+)<\/Size>/;
const ERROR_RE = /<Error>/;

function parsePart(block: string): MultipartPart | null {
	const partNumber = PART_NUMBER_RE.exec(block)?.[1];
	const etag = ETAG_RE.exec(block)?.[1];
	const size = SIZE_RE.exec(block)?.[1];
	if (!(partNumber && etag && size)) {
		return null;
	}
	return { partNumber: Number(partNumber), etag, size: Number(size) };
}

function completeBody(
	parts: Pick<MultipartPart, "etag" | "partNumber">[]
): string {
	const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
	const entries = sorted
		.map(
			(part) =>
				`<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`
		)
		.join("");
	return `<CompleteMultipartUpload>${entries}</CompleteMultipartUpload>`;
}

function expectOk(res: Response, what: string): Response {
	if (!res.ok) {
		throw new Error(`S3 ${what} failed: ${res.status}`);
	}
	return res;
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
	return data instanceof ArrayBuffer
		? data
		: (data.buffer.slice(
				data.byteOffset,
				data.byteOffset + data.byteLength
			) as ArrayBuffer);
}

// The signed-request context the op factories below share; created once per
// bucket in createS3Bucket.
interface S3Ctx {
	aws: AwsClient;
	objectUrl: (key: string) => string;
	uploadUrl: (key: string, uploadId: string, extra?: string) => string;
}

function makeObjectOps(
	ctx: S3Ctx
): Pick<MultipartBucket, "delete" | "get" | "getStream" | "put"> {
	return {
		async get(key): Promise<R2ObjectBody | null> {
			const res = await ctx.aws.fetch(ctx.objectUrl(key));
			if (res.status === NOT_FOUND) {
				return null;
			}
			if (res.status !== OK) {
				throw new Error(`S3 GET ${key} failed: ${res.status}`);
			}
			const bytes = await res.arrayBuffer();
			return { arrayBuffer: () => Promise.resolve(bytes) };
		},
		async getStream(key) {
			const res = await ctx.aws.fetch(ctx.objectUrl(key));
			if (res.status === NOT_FOUND) {
				return null;
			}
			if (res.status !== OK) {
				throw new Error(`S3 GET ${key} failed: ${res.status}`);
			}
			return res.body;
		},
		async put(key, value) {
			const res = await ctx.aws.fetch(ctx.objectUrl(key), {
				method: "PUT",
				body: toArrayBuffer(value),
			});
			expectOk(res, `PUT ${key}`);
		},
		async delete(key) {
			const res = await ctx.aws.fetch(ctx.objectUrl(key), {
				method: "DELETE",
			});
			if (!(res.ok || res.status === NOT_FOUND)) {
				throw new Error(`S3 DELETE ${key} failed: ${res.status}`);
			}
		},
	};
}

function makeUploadOps(
	ctx: S3Ctx
): Pick<MultipartBucket, "createMultipartUpload" | "uploadPart"> {
	return {
		async createMultipartUpload(key, mime) {
			const res = await ctx.aws.fetch(`${ctx.objectUrl(key)}?uploads`, {
				method: "POST",
				headers: { "content-type": mime },
			});
			const xml = await expectOk(res, `POST ?uploads ${key}`).text();
			const uploadId = UPLOAD_ID_RE.exec(xml)?.[1];
			if (!uploadId) {
				throw new Error(`S3 create multipart upload for ${key}: no UploadId`);
			}
			return uploadId;
		},
		async uploadPart(key, uploadId, partNumber, data) {
			const res = await ctx.aws.fetch(
				ctx.uploadUrl(key, uploadId, `&partNumber=${partNumber}`),
				{ method: "PUT", body: toArrayBuffer(data) }
			);
			expectOk(res, `upload part ${partNumber} of ${key}`);
			const etag = res.headers.get("etag");
			if (!etag) {
				throw new Error(`S3 upload part ${partNumber} of ${key}: no ETag`);
			}
			return { partNumber, etag, size: data.byteLength };
		},
	};
}

function makeFinishOps(
	ctx: S3Ctx
): Pick<
	MultipartBucket,
	"abortMultipartUpload" | "completeMultipartUpload" | "listParts"
> {
	return {
		async listParts(key, uploadId) {
			const res = await ctx.aws.fetch(ctx.uploadUrl(key, uploadId));
			const xml = await expectOk(res, `list parts of ${key}`).text();
			const parts: MultipartPart[] = [];
			for (const match of xml.matchAll(PART_BLOCK_RE)) {
				const part = parsePart(match[0]);
				if (part) {
					parts.push(part);
				}
			}
			return parts;
		},
		async completeMultipartUpload(key, uploadId, parts) {
			const res = await ctx.aws.fetch(ctx.uploadUrl(key, uploadId), {
				method: "POST",
				headers: { "content-type": "application/xml" },
				body: completeBody(parts),
			});
			const xml = await expectOk(res, `complete ${key}`).text();
			// S3 can return 200 with an <Error> body for a failed complete.
			if (ERROR_RE.test(xml)) {
				throw new Error(`S3 complete multipart upload for ${key} errored`);
			}
		},
		async abortMultipartUpload(key, uploadId) {
			const res = await ctx.aws.fetch(ctx.uploadUrl(key, uploadId), {
				method: "DELETE",
			});
			// A 404 means the upload is already gone — the desired end state.
			if (!(res.ok || res.status === NOT_FOUND)) {
				throw new Error(`S3 abort upload for ${key} failed: ${res.status}`);
			}
		},
	};
}

export function createS3Bucket(config: S3BucketConfig): MultipartBucket {
	const aws = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		// R2 ignores region but the SigV4 signature needs one.
		region: "auto",
	});
	const objectUrl = (key: string) =>
		`${config.endpoint}/${config.bucket}/${encodeURIComponent(key)}`;
	const ctx: S3Ctx = {
		aws,
		objectUrl,
		uploadUrl: (key, uploadId, extra = "") =>
			`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}${extra}`,
	};
	return {
		...makeObjectOps(ctx),
		...makeUploadOps(ctx),
		...makeFinishOps(ctx),
	};
}
