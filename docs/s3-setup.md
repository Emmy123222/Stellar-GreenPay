# S3 Bucket Policy and CORS Setup

Infrastructure guide for the document-upload S3 bucket used when `STORAGE_BACKEND=s3` (see `backend/src/services/storage.js` and `backend/.env.example`).

Uploaded objects are served with public-read access so clients can load them via `S3_PUBLIC_URL` or the default bucket URL. Browser uploads that use presigned URLs need a CORS rule that allows `PUT` from the frontend origin.

Replace placeholders before applying:

| Placeholder | Example |
|-------------|---------|
| `BUCKET_NAME` | `greenpay-uploads-prod` |
| `AWS_ACCOUNT_ID` | `123456789012` |
| Frontend origin | `https://greenpay.app` (also allow `https://www.greenpay.app`, `https://stellar-greenpay.app`, and local `http://localhost:3000` if needed) |

---

## 1. Bucket policy (public-read for uploaded objects)

This policy allows anonymous `s3:GetObject` on every object in the bucket so uploaded files are readable at their public URL. It does **not** grant public write; uploads still go through authenticated SDK calls or time-limited presigned URLs.

> **Note:** Public access requires Block Public Access settings that allow bucket policies (at minimum, turn off “Block public access to buckets and objects granted through new public bucket policies” for this bucket). Prefer a CloudFront distribution in front of the bucket for production.

### Terraform

```hcl
resource "aws_s3_bucket" "uploads" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "uploads_public_read" {
  bucket = aws_s3_bucket.uploads.id

  depends_on = [aws_s3_bucket_public_access_block.uploads]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.uploads.arn}/*"
      }
    ]
  })
}
```

### AWS CLI

Save the policy to `bucket-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET_NAME/*"
    }
  ]
}
```

Apply it:

```bash
# Allow the public bucket policy (adjust flags to match your org’s baseline)
aws s3api put-public-access-block \
  --bucket BUCKET_NAME \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

aws s3api put-bucket-policy \
  --bucket BUCKET_NAME \
  --policy file://bucket-policy.json
```

Verify:

```bash
aws s3api get-bucket-policy --bucket BUCKET_NAME --query Policy --output text
```

---

## 2. CORS configuration (PUT from the frontend for presigned uploads)

When the browser uploads directly to S3 with a presigned URL, the bucket must respond to CORS preflight and allow `PUT` from the frontend origin. Headers below cover common signed-upload cases (`Content-Type`, checksum, and AWS signature headers).

### Terraform

```hcl
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = [
      "https://greenpay.app",
      "https://www.greenpay.app",
      "https://stellar-greenpay.app",
      "https://www.stellar-greenpay.app",
      # Uncomment for local frontend development:
      # "http://localhost:3000",
    ]
    expose_headers  = ["ETag", "x-amz-request-id"]
    max_age_seconds = 3000
  }
}
```

### AWS CLI

Save the CORS config to `cors.json`:

```json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedOrigins": [
        "https://greenpay.app",
        "https://www.greenpay.app",
        "https://stellar-greenpay.app",
        "https://www.stellar-greenpay.app"
      ],
      "ExposeHeaders": ["ETag", "x-amz-request-id"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

Apply it:

```bash
aws s3api put-bucket-cors \
  --bucket BUCKET_NAME \
  --cors-configuration file://cors.json
```

Verify:

```bash
aws s3api get-bucket-cors --bucket BUCKET_NAME
```

For local development, add `"http://localhost:3000"` to `AllowedOrigins` (or `allowed_origins` in Terraform) and re-apply.

---

## 3. Related app configuration

After the bucket policy and CORS are in place, point the backend at the bucket:

```bash
STORAGE_BACKEND=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=BUCKET_NAME
# Optional CDN or custom domain for public object URLs:
# S3_PUBLIC_URL=https://uploads.greenpay.app
```

The storage service uploads with `ACL: public-read`. If your account disables ACLs (Bucket owner enforced), rely on the bucket policy above for public reads and omit object ACLs in the application upload path.
