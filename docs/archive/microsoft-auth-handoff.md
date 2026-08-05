# Microsoft sign-in handoff

The application is currently in `demo` authentication mode. The login screen is Microsoft-first, but demo accounts remain available so product review can continue before the Entra app registration exists.

## What IT needs to provide

- Microsoft Entra tenant ID
- Application (client) ID
- A client secret or certificate managed through the approved secret store
- Approved redirect URI for every environment
- Approved post-logout redirect URI
- Confirmation of whether users are assigned directly, by group, or through enterprise application assignment

The minimum OpenID Connect scopes for sign-in are `openid profile email`. Microsoft Graph permissions are not required just to identify a user from validated ID-token claims. Add Graph access only if a later directory-sync feature requires it.

## Configuration contract

Copy `.env.example` to the environment's secret configuration and set:

```text
DEMO_MODE=false
AUTH_MODE=microsoft
ENABLE_DEMO_LOGIN=false
VITE_ENABLE_DEMO_LOGIN=false
MICROSOFT_TENANT_ID=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_REDIRECT_URI=https://your-host/api/auth/microsoft/callback
SESSION_SECRET=...
```

`GET /api/auth/config` is the public capability contract consumed by the UI. It never returns tenant IDs, client IDs, or secrets. `GET /api/auth/microsoft/start` is reserved as the stable entry point for the approved OIDC adapter.

## Work remaining after access is granted

1. Install the organization-approved Microsoft OIDC/MSAL server adapter.
2. Implement authorization-code flow with PKCE, state, nonce, and a server-side session store.
3. Validate issuer, audience, signature, expiry, nonce, and tenant on every callback.
4. Resolve the validated `oid` claim against `users.entra_object_id`; use `preferred_username` only as a controlled migration fallback.
5. Issue `HttpOnly`, `Secure`, `SameSite=Lax` session cookies and add logout/session-expiry handling.
6. Replace the temporary `X-User-Id` trust path and protect uploaded files by the authenticated session plus resource authorization.
7. Test allowed, disabled, unassigned, wrong-tenant, expired-session, and account-removal cases before changing `AUTH_MODE`.

Roles remain application-managed for now. A successful Microsoft sign-in identifies the employee; the existing user record continues to determine Requestor, Approver, Custodian, Finance, or Admin access until the business chooses a group/app-role mapping policy.

## Microsoft profile photos

The current avatars are demo files under `public/avatars`; Microsoft sign-in does not replace them automatically. Entra ID tokens provide identity claims such as `oid`, `name`, and `preferred_username`, but not the user's profile-photo bytes.

When the Microsoft adapter is implemented, request the approved least-privilege Microsoft Graph permission and fetch a fixed-size image such as `GET /me/photos/96x96/$value`. Cache or proxy the binary through the authenticated backend, write the resulting internal URL to `users.avatar_url`, and fall back to initials when Graph returns no photo. Never expose a Graph access token or use an expiring bearer URL directly in an `<img>` element.
