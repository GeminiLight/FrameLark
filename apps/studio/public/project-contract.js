// Byte limits are shared by documents, HTTP adapters and portable project storage.
export const projectLimits=Object.freeze({
  documentBytes:1024*1024,
  metadataBytes:200_000,
  documentRequestBytes:2*1024*1024,
  snapshotRequestBytes:4*1024*1024,
  recordBytes:4*1024*1024,
  expandedBytes:128*1024*1024
});
