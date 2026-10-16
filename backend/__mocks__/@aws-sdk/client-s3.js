"use strict";
// Stub for @aws-sdk/client-s3 — not installed; only used in S3 storage path.
const S3Client = jest.fn().mockImplementation(() => ({}));
const PutObjectCommand = jest.fn().mockImplementation((params) => ({ _params: params }));
module.exports = { S3Client, PutObjectCommand };
