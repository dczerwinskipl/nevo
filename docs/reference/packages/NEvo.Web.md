---
id: packages.nevo-web
type: package
title: NEvo.Web
status: current
dependencies:
  - NEvo.Core
summary: >
  HTTP client wrapper: named/configured HttpClient instances with pluggable
  authentication (OAuth client-credentials or none) and a REST client base. Not ASP.NET
  Core middleware or routing, despite the name.
---

# NEvo.Web

## Purpose

`NEvo.Web` (namespace `NEvo.Web.Client`) wraps `IHttpClientFactory` with named,
configured client instances, pluggable authentication, and a REST convenience base
class. It is an **outbound HTTP client library**, not ASP.NET Core middleware or
routing — every real source file is under `Client/`.

## When to use

Whenever a service needs to make outbound HTTP calls with named/configured clients,
optionally with OAuth client-credentials authentication.

## When not to use

For inbound HTTP (exposing your own endpoints), this package is not relevant — see
[`NEvo.Messaging.Web`](NEvo.Messaging.Web.md) for message/command endpoint mapping, or
plain ASP.NET Core routing for anything outside NEvo's messaging pipeline.

## Responsibilities

- Register and configure named `HttpClient` instances (`AddHttpClientServices`,
  `HttpClientServiceConfiguration`).
- Authenticate outbound requests via a pluggable strategy
  (`IAuthenticationStrategy`: `NoAuthenticationStrategy` or
  `OAuthAuthenticationStrategy`, client-credentials flow).
- Provide a base class for typed HTTP clients (`HttpClientServiceBase`) and a REST
  convenience layer on top (`RestClientServiceBase`: `GetAsync`/`PostAsync` with JSON
  (de)serialization).

## Dependencies

Depends only on `NEvo.Core` — see `src/NEvo.Web/NEvo.Web.csproj`'s single
`ProjectReference`.

## Public surface

Grounded directly in `src/NEvo.Web/Client/**/*.cs`.

```csharp
public interface IHttpClientServiceFactory
{
    Task<Either<Exception, HttpClient>> CreateClientAsync(string name);
}

public interface IAuthenticationStrategy
{
    Task<Either<Exception, HttpClient>> AuthenticateHttpClientAsync(HttpClient client);
}

public abstract class HttpClientServiceBase(IHttpClientServiceFactory httpClientFactory, IOptions<HttpClientServiceConfiguration> options)
{
    protected Task<Either<Exception, HttpResponseMessage>> SendAsync(HttpRequestMessage request);
}

public abstract class RestClientServiceBase : HttpClientServiceBase
{
    protected Task<Either<Exception, TResponse>> GetAsync<TResponse>(string url, IDictionary<string, string>? queryParams = null);
    protected Task<Either<Exception, TResponse>> PostAsync<TResponse>(string url, IDictionary<string, string>? queryParams = null);
    protected Task<Either<Exception, TResponse>> PostAsync<TRequest, TResponse>(string url, TRequest requestData, IDictionary<string, string>? queryParams = null);
}
```

`HttpClientServiceBase.SendAsync` wraps `HttpClient.SendAsync`, converting a
non-success status code into a `Left(HttpRequestException)` and any thrown exception
(network failure, etc.) into `Left(ex)` — a caller never needs a `try`/`catch` around
it, per NEvo's `Either<Exception, T>` convention (see [`NEvo.Core.md`](NEvo.Core.md)).

## Configuration

```csharp
builder.Services.AddHttpClientService<IMyApiClient, MyApiClient>(opts =>
{
    opts.Name = "my-api";
    opts.BaseAddress = new Uri("https://api.example.com");
    opts.AuthenticationStrategy = new OAuthAuthenticationStrategy(/* ... */);
});
```

`AddHttpClientService<TService, TClient>` registers the named `HttpClient` (via
`IHttpClientFactory`), the `HttpClientServiceConfiguration` (as named options), and
`TService` → `TClient` (constructed via `ActivatorUtilities`, so `TClient` can take
additional DI-resolved constructor parameters beyond the required
`IHttpClientServiceFactory`/`IOptions<HttpClientServiceConfiguration>`). The simpler
`AddHttpClientService<TService, TClient>(name, baseAddress)` overload defaults to
`NoAuthenticationStrategy`.

`OAuthAuthenticationStrategy` fetches a bearer token via the OAuth2 client-credentials
grant (`grant_type=client_credentials`) against a configured token endpoint, then sets
it as the outbound `Authorization` header. It is itself an `HttpClientServiceBase`
subclass — token-fetching goes through the same `SendAsync`/error-wrapping as any other
request. It only supports the client-credentials grant — no authorization-code,
refresh-token, or token-caching support; a token is fetched fresh on every
`AuthenticateHttpClientAsync` call.

## Limitations

- `OAuthAuthenticationStrategy` only supports the client-credentials grant, with no
  token caching between requests.
- A failed response's body is discarded — see `docs/project/known-issues.md` § "A
  failed HTTP response's body is discarded".
- `RestClientServiceBase.GetAsync` puts `queryParams` in the request body rather than
  the URL query string — see `docs/project/known-issues.md` § "`RestClientServiceBase.GetAsync`
  puts query parameters in the request body" before relying on it.

## Related packages

- [`NEvo.Core`](NEvo.Core.md) — the only dependency.
- [`NEvo.Messaging.Web`](NEvo.Messaging.Web.md) — builds its REST message dispatch on
  top of this package's HTTP client wrapper (`AddHttpClientServices`).
- [`NEvo.Web.Authorization`](NEvo.Web.Authorization.md) — despite the similar name,
  has no dependency on this package (see that doc's "Dependencies").

## Examples and tests

No dedicated `tests/NEvo.Web.Tests/` project exists in this repository today.
