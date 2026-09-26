# Architecture Documentation

## Admin Authentication Model

### Overview
The Stellar GreenPay platform implements a multi-layered authentication system for administrative operations to ensure security and proper access control.

### Authentication Methods

#### 1. JWT-Based Authentication
Admin users authenticate using JSON Web Tokens (JWT) with role-based access control.

**Token Types:**
- **Standard Admin Token**: 1-hour TTL, used for general admin operations
- **Short-Lived Admin Token**: 15-minute TTL, used for sensitive operations (project registration, user management, status changes)
- **Refresh Token**: 24-hour TTL, used to obtain new access tokens

**Token Structure:**
```json
{
  "role": "admin",
  "sub": "username",
  "type": "admin|refresh",
  "iat": 1234567890,
  "exp": 1234571490
}
```

#### 2. API Key Authentication
For automated systems and internal services, admin API keys can be used via the `X-Admin-Key` header.

**Configuration:**
- `ADMIN_API_KEY`: Primary admin API key
- `ADMIN_API_KEYS`: Comma-separated list of rotated keys for key rotation support

### Route Protection Levels

#### Level 1: Standard Admin Protection (`adminRequired`)
Used for read-only admin operations and non-sensitive administrative tasks.

**Protected Routes:**
- `GET /api/admin/me` - Get admin profile
- `GET /api/admin/audit-log` - View audit logs
- `POST /api/admin/digest/preview` - Preview email digests
- `GET /api/verification-requests/stats` - Get verification statistics
- `GET /api/verification-requests` - List verification requests

**Authentication Requirements:**
- Valid JWT with `role: "admin"` claim, OR
- Valid `X-Admin-Key` header

#### Level 2: Enhanced Admin Protection (`adminTokenRequired`)
Used for sensitive administrative operations that modify data or perform critical actions.

**Protected Routes:**
- `POST /api/projects/admin/register` - Register projects on-chain
- `POST /api/projects/admin/confirm` - Confirm project registrations
- `PATCH /api/projects/:id/webhook` - Update project webhooks
- `PATCH /api/verification-requests/:id/status` - Change verification request status
- `DELETE /api/verification-requests/:id` - Delete verification requests
- `POST /api/updates` - Create project updates

**Authentication Requirements:**
- Valid short-lived admin token (15-minute TTL) with `role: "admin"` and `type: "admin"` claims, OR
- Valid `X-Admin-Key` header

### Security Features

#### Role-Based Access Control
All admin tokens must include a `role: "admin"` claim. The middleware verifies this claim before granting access to protected routes.

#### Time-Based Token Expiration
- Standard admin tokens expire after 1 hour
- Short-lived admin tokens expire after 15 minutes
- Refresh tokens expire after 24 hours
- This limits the window of opportunity for token theft

#### Token Type Validation
Enhanced admin protection requires tokens with `type: "admin"` claim, preventing standard tokens from being used for sensitive operations.

#### Timing-Safe Key Comparison
API key comparison uses timing-safe functions to prevent timing attacks.

### Implementation Details

#### Middleware Functions
- `adminRequired(req, res, next)`: Standard admin authentication
- `adminTokenRequired(req, res, next)`: Enhanced admin authentication with short-lived token validation
- `adminKeyRequired(req, res, next)`: API key-only authentication

#### Token Generation
```javascript
// Standard admin token
const token = signToken({ role: "admin", sub: username }, "1h");

// Short-lived admin token for sensitive operations
const adminToken = signAdminToken({ role: "admin", sub: username, type: "admin" });

// Refresh token
const refreshToken = signToken({ role: "admin", sub: username, type: "refresh" }, "24h");
```

### Deployment Considerations

#### IP Allowlisting (Optional)
For additional security, consider restricting admin routes to internal networks via nginx IP allowlisting:

```nginx
location /api/admin/ {
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
    # ... proxy_pass configuration
}
```

#### Environment Variables
Required environment variables for admin authentication:
- `JWT_SECRET`: Secret key for JWT signing/verification
- `ADMIN_USERNAME`: Admin username for login
- `ADMIN_PASSWORD`: Admin password for login
- `ADMIN_API_KEY`: (Optional) API key for automated admin access
- `ADMIN_API_KEYS`: (Optional) Comma-separated list of rotated API keys

### Audit Logging
All administrative actions are logged to the `admin_audit_log` table with:
- Actor (admin username or identifier)
- Action performed
- Target type and ID
- IP address
- Timestamp
- Additional metadata

### Security Best Practices

1. **Token Storage**: Store tokens securely (httpOnly cookies, secure storage)
2. **Key Rotation**: Regularly rotate JWT secrets and API keys
3. **Monitoring**: Monitor audit logs for suspicious activity
4. **Rate Limiting**: Admin login endpoints are rate-limited
5. **Network Security**: Consider VPN/private network access for admin operations
6. **Token Refresh**: Implement proper token refresh mechanisms
7. **Error Handling**: Return generic error messages to prevent information leakage

### Migration Guide

When upgrading to the enhanced authentication model:

1. Update admin clients to handle the new `adminToken` field in login responses
2. Use `adminToken` for sensitive operations instead of the standard `token`
3. Implement token refresh logic to handle short-lived token expiration
4. Update API calls to use the appropriate token based on operation sensitivity
5. Test all admin operations with both authentication methods

### Testing

Authentication is tested in:
- `backend/src/routes/admin.test.js` - Admin route authentication tests
- `backend/src/middleware/auth.test.js` - Authentication middleware tests

Test coverage includes:
- Valid token authentication
- Invalid token rejection
- Expired token handling
- API key authentication
- Role claim validation
- Token type validation
