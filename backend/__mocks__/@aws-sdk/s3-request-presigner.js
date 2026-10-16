"use strict";
// Stub for @aws-sdk/s3-request-presigner — not installed.
const getSignedUrl = jest.fn().mockResolvedValue("https://mock-presigned-url.example.com");
module.exports = { getSignedUrl };
