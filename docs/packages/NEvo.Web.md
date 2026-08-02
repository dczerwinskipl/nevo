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

Depends only on `NEvo.Core` — confirmed against
`src/NEvo.Web/NEvo.Web.csproj`'s single `ProjectReference`.

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
it, per NEvo's `Either<Exception, T>` convention (see
[`NEvo.Core.md`](NEvo.Core.md)).

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

## Basic usage

```csharp
public interface IMyApiClient { Task<Either<Exception, MyDto>> GetThingAsync(string id); }

public class MyApiClient(IHttpClientServiceFactory factory, IOptions<HttpClientServiceConfiguration> options)
    : RestClientServiceBase(factory, options), IMyApiClient
{
    public Task<Either<Exception, MyDto>> GetThingAsync(string id) => GetAsync<MyDto>($"/things/{id}");
}
```

## Advanced usage

`OAuthAuthenticationStrategy` fetches a bearer token via the OAuth2 client-credentials
grant (`grant_type=client_credentials`) against a configured token endpoint, then sets
it as the outbound `Authorization` header. It is itself an `HttpClientServiceBase`
subclass — token-fetching goes through the same `SendAsync`/error-wrapping as any other
request.

## Limitations

- `OAuthAuthenticationStrategy` only supports the client-credentials grant — no
  authorization-code, refresh-token, or token-caching support. A token is fetched fresh
  on every `AuthenticateHttpClientAsync` call (no caching between requests).
- `HttpClientServiceBase.SendAsync`'s error branch has a `// TOOD: add some extractor
  for details of error` comment — a non-success response's body is discarded; only the
  status code reaches the resulting `HttpRequestException` message.
- `RestClientServiceBase.GetAsync` puts `queryParams` in the request body via
  `FormUrlEncodedContent`, not the URL query string — this is likely unintentional
  (`PostAsync` correctly uses `QueryHelpers.AddQueryString` for the same parameter);
  confirm this is what you want before relying on `GetAsync` with query parameters.

## Related packages

- [`NEvo.Core`](NEvo.Core.md) — the only dependency.
- [`NEvo.Messaging.Web`](NEvo.Messaging.Web.md) — builds its REST message dispatch on
  top of this package's HTTP client wrapper (`AddHttpClientServices`).
- [`NEvo.Web.Authorization`](NEvo.Web.Authorization.md) — despite the similar name,
  has no dependency on this package (see that doc's "Dependencies").

## Examples and tests

No dedicated `tests/NEvo.Web.Tests/` project exists in this repository today.
