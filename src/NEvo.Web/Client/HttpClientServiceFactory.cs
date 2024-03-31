using LanguageExt;
using Microsoft.Extensions.Options;

namespace NEvo.Web.Client;

public class HttpClientServiceConfiguration
{
    public string Name { get; set; } = string.Empty;
    public Uri BaseAddress { get; set; }
    public IAuthenticationStrategy AuthenticationStrategy { get; set; } = new NoAuthenticationStrategy();
}

public class HttpClientServiceFactory : IHttpClientServiceFactory
{
    private readonly IHttpClientFactory _baseFactory;
    private readonly IOptionsMonitor<HttpClientServiceConfiguration> _options;

    public HttpClientServiceFactory(IHttpClientFactory baseFactory, IOptionsMonitor<HttpClientServiceConfiguration> options)
    {
        _baseFactory = baseFactory;
        _options = options;
    }

    public async Task<Either<Exception, HttpClient>> CreateClientAsync(string name)
    {
        var configuration = _options.Get(name) ?? new();
        var client = _baseFactory.CreateClient(name);
        return await configuration.AuthenticationStrategy.AuthenticateHttpClientAsync(client);
    }
}
