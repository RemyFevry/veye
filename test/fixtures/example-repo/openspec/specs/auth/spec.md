# Auth Spec

## Requirements

### Requirement: Login returns a session token

The login endpoint SHALL accept credentials and return a signed session token
on success.

#### Scenario: Valid credentials yield a token
- **WHEN** the caller submits a valid email and password
- **THEN** a signed session token is returned with a 200 status

#### Scenario: Invalid credentials are rejected
- **WHEN** the caller submits an incorrect password
- **THEN** a 401 status is returned and no token is issued

### Requirement: Logout invalidates the session

The logout endpoint SHALL invalidate the caller's session token so that
subsequent requests using it are rejected.

#### Scenario: Logout clears the session
- **WHEN** an authenticated caller hits the logout endpoint
- **THEN** the session entry is removed and future requests with that token
  receive a 401

### Requirement: Middleware guards protected routes

A middleware SHALL run before protected routes and SHALL reject requests that
carry no valid session token.

#### Scenario: Missing token is rejected
- **WHEN** a request to a protected route omits the Authorization header
- **THEN** the middleware responds with 401 before the route handler runs

#### Scenario: Valid token attaches principal
- **WHEN** a request carries a valid bearer token
- **THEN** the decoded principal is attached to the request and the handler
  proceeds
