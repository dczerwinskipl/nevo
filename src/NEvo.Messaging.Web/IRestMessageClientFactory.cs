using Microsoft.Extensions.Options;
using NEvo.Web.Client;

namespace NEvo.Messaging.Web;

public interface IRestMessageClientFactory
{
    bool ContainConfiguration(IMessage message);
    IRestMessageClientService CreateFor(IMessage message);
}

public record RestMessageClientFactoryConfiguration
{
    public Dictionary<Type, string> MessageMapping { get; } = [];
}

public class RestMessageClientFactory(IHttpClientServiceFactory httpClientFactory, IOptions<RestMessageClientFactoryConfiguration> factoryOptions, IOptionsMonitor<HttpClientServiceConfiguration> clientOptions) : IRestMessageClientFactory
{
    private readonly RestMessageClientFactoryConfiguration configuration = factoryOptions.Value;

    public bool ContainConfiguration(IMessage message) => configuration.MessageMapping.ContainsKey(message.GetType());

    public IRestMessageClientService CreateFor(IMessage message)
    {
        var name = configuration.MessageMapping[message.GetType()];
        return new RestMessageClientService(httpClientFactory, Options.Create(clientOptions.Get(name)));
    }
}