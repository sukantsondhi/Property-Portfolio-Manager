import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { getCredential } from './credential';
import { StoreError } from './responses';

export const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export const maxFileSize = 25 * 1024 * 1024;
const safeName = (name: string) => name.normalize('NFKC').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '-').slice(0, 180);
const extensionsByMime = new Map([
  ['application/pdf', ['pdf']],
  ['image/jpeg', ['jpg', 'jpeg']],
  ['image/png', ['png']],
  ['image/webp', ['webp']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['docx']],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['xlsx']],
]);

function service() {
  const account = process.env.STORAGE_ACCOUNT_NAME;
  if (!account) throw new Error('STORAGE_ACCOUNT_NAME is required.');
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;
  const sharedKey = accountKey ? new StorageSharedKeyCredential(account, accountKey) : undefined;
  const endpoint = process.env.STORAGE_BLOB_ENDPOINT ?? `https://${account}.blob.core.windows.net`;
  return { account, sharedKey, client: new BlobServiceClient(endpoint, sharedKey ?? getCredential()) };
}
export function buildBlobName(documentId: string, propertyId: string | undefined, category: string, fileName: string, organizationId = "unassigned") { return `org/${safeName(organizationId)}/${propertyId || 'unassigned'}/${safeName(category)}/${documentId}/${safeName(fileName)}`; }

export function assertFileSignature(fileName: string, mimeType: string, content: Buffer) {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!extensionsByMime.get(mimeType)?.includes(extension))
    throw new StoreError(400, 'file_extension_mismatch', 'The file extension does not match its declared type.');
  const starts = (...bytes: number[]) => bytes.every((byte, index) => content[index] === byte);
  const ascii = content.toString('latin1');
  const valid = mimeType === 'application/pdf' ? content.subarray(0, 5).toString('ascii') === '%PDF-'
    : mimeType === 'image/jpeg' ? starts(0xff, 0xd8, 0xff)
    : mimeType === 'image/png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : mimeType === 'image/webp' ? content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP'
    : mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? starts(0x50, 0x4b, 0x03, 0x04) && ascii.includes('word/')
    : mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ? starts(0x50, 0x4b, 0x03, 0x04) && ascii.includes('xl/')
    : false;
  if (!valid) throw new StoreError(400, 'invalid_file_signature', 'The file contents do not match the declared type.');
}

async function sas(blobName: string, permissions: string, responseHeaders: { contentType?: string; contentDisposition?: string; cacheControl?: string } = {}) {
  const { account, client, sharedKey } = service(); const startsOn = new Date(Date.now() - 5 * 60_000); const expiresOn = new Date(Date.now() + 10 * 60_000);
  const containerName = process.env.STORAGE_CONTAINER ?? 'documents';
  if (process.env.STORAGE_BLOB_ENDPOINT) await client.getContainerClient(containerName).createIfNotExists();
  const options = { containerName, blobName, permissions: BlobSASPermissions.parse(permissions), startsOn, expiresOn, ...responseHeaders };
  const query = sharedKey
    ? generateBlobSASQueryParameters(options, sharedKey).toString()
    : generateBlobSASQueryParameters(options, await client.getUserDelegationKey(startsOn, expiresOn), account).toString();
  return { url: `${client.url}/${process.env.STORAGE_CONTAINER ?? 'documents'}/${blobName}?${query}`, expiresAt: expiresOn.toISOString() };
}
export async function uploadBlob(blobName: string, mimeType: string, content: Buffer) {
  if (!content.length || content.length > maxFileSize) throw new StoreError(413, 'upload_too_large', 'Use a file of at most 25 MiB.');
  const container = service().client.getContainerClient(process.env.STORAGE_CONTAINER ?? 'documents');
  if (process.env.STORAGE_BLOB_ENDPOINT) await container.createIfNotExists();
  await container.getBlockBlobClient(blobName).uploadData(content, {
    conditions: { ifNoneMatch: '*' },
    blobHTTPHeaders: { blobContentType: mimeType, blobCacheControl: 'private, no-store' },
    abortSignal: AbortSignal.timeout(30_000),
  });
}
export const downloadSas = (blobName: string, fileName: string, mimeType: string) => sas(blobName, 'r', {
  contentType: mimeType,
  contentDisposition: `attachment; filename="${safeName(fileName) || 'document'}"`,
  cacheControl: 'private, no-store'
});
export const viewSas = (blobName: string, mimeType: string) => sas(blobName, 'r', {
  contentType: mimeType,
  contentDisposition: 'inline',
  cacheControl: 'private, max-age=300'
});
export async function blobProperties(blobName: string) { try { return await service().client.getContainerClient(process.env.STORAGE_CONTAINER ?? 'documents').getBlobClient(blobName).getProperties(); } catch (error: any) { if (error.statusCode === 404) throw new StoreError(400, 'upload_missing', 'The uploaded blob could not be found.'); throw error; } }
export async function deleteBlob(blobName: string) { return service().client.getContainerClient(process.env.STORAGE_CONTAINER ?? 'documents').getBlobClient(blobName).deleteIfExists({ deleteSnapshots: 'include' }); }
export async function downloadBlobBase64(blobName: string, maxBytes = maxFileSize) {
  return (await downloadBlobBuffer(blobName, maxBytes)).toString('base64');
}
export async function downloadBlobBuffer(blobName: string, maxBytes = maxFileSize) {
  const blob = service().client
    .getContainerClient(process.env.STORAGE_CONTAINER ?? 'documents')
    .getBlobClient(blobName);
  const properties = await blob.getProperties();
  if (!properties.contentLength || properties.contentLength > Math.min(maxBytes, maxFileSize))
    throw new StoreError(413, 'download_too_large', 'This file exceeds the permitted download size.');
  return blob.downloadToBuffer(0, properties.contentLength, { conditions: { ifMatch: properties.etag }, abortSignal: AbortSignal.timeout(30_000) });
}
