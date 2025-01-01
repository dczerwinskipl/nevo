using LanguageExt;
using Microsoft.Extensions.Options;

namespace NEvo.Web.Client;

public class HttpClientServiceConfiguration
{
    public string Name { get; set; } = string.Empty;
    public Uri BaseAddress { get; set; }
    public IAuthenticationStrategy AuthenticationStrategy { get; set; } = new NoAuthenticationStrategy();
}

public class HttpClientServiceFactory(IHttpClientFactory baseFactory, IOptionsMonitor<HttpClientServiceConfiguration> options) : IHttpClientServiceFactory
{
    public async Task<Either<Exception, HttpClient>> CreateClientAsync(string name)
    {
        var configuration = options.Get(name) ?? new();
        var client = baseFactory.CreateClient(name);
        return await configuration.AuthenticationStrategy.AuthenticateHttpClientAsync(client);
    }
}
