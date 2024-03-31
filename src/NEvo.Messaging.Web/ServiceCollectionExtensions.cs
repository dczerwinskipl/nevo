using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Dispatch.External;
using NEvo.Messaging.Web;
using NEvo.Web.Client;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    //TODO: make it more like builder
    public static IServiceCollection AddRestMessageDispatcher(this IServiceCollection services)
    {
        services.TryAddSingleton<IRestMessageClientFactory, RestMessageClientFactory>();
        services.TryAddScoped<IExternalMessageDispatchStrategy, RestExternalMessageDispatchStrategy>();
        return services;
    }

    public static IServiceCollection AddRestMessageDispatcher(this IServiceCollection services, Action<HttpClientServiceConfiguration> configure, params Type[] messages)
    {
        services.AddRestMessageDispatcher();
        services.AddHttpClientServices(configure, out var name);
        services.Configure<RestMessageClientFactoryConfiguration>(opts =>
        {
            foreach (var type in messages)
            {
                opts.MessageMapping[type] = name;
            }
        });
        services.Configure<CommandDispatchStrategyConfiguration>(opts =>
        {
            foreach (var type in messages)
            {
                opts.ExternalTypes.Add(type);
            }
        });
        return services;
    }
}
