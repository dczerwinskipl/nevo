using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using NEvo.Web.Client;

namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddHttpClientService<TService, TClient>(this IServiceCollection serviceCollection, string name, string baseAddress)
        where TService : class
        where TClient : HttpClientServiceBase, TService
    {
        return serviceCollection.AddHttpClientService<TService, TClient>((opts) =>
        {
            opts.Name = name;
            opts.BaseAddress = baseAddress;
        });
    }

    public static IServiceCollection AddHttpClientServices(this IServiceCollection serviceCollection, Action<HttpClientServiceConfiguration> configure, out string name)
    {
        serviceCollection.AddHttpClient();
        serviceCollection.TryAddSingleton<IHttpClientServiceFactory, HttpClientServiceFactory>();

        var httpClientConfiguration = new HttpClientServiceConfiguration();
        configure(httpClientConfiguration);
        name = httpClientConfiguration.Name;

        serviceCollection.Configure<HttpClientServiceConfiguration>(name, opts =>
        {
            opts.BaseAddress = httpClientConfiguration.BaseAddress;
            opts.Name = httpClientConfiguration.Name;
            opts.AuthenticationStrategy = httpClientConfiguration.AuthenticationStrategy;
        });
        serviceCollection.AddHttpClient(httpClientConfiguration.Name, action => action.BaseAddress = new Uri(httpClientConfiguration.BaseAddress));

        return serviceCollection;
    }

    public static IServiceCollection AddHttpClientService<TService, TClient>(this IServiceCollection serviceCollection, Action<HttpClientServiceConfiguration> configure)
        where TService : class
        where TClient : HttpClientServiceBase, TService
    {
        serviceCollection.AddHttpClientServices(configure, out var name);
        serviceCollection.AddScoped<TService, TClient>(serviceProvider =>
        {
            var options = serviceProvider.GetRequiredService<IOptionsSnapshot<HttpClientServiceConfiguration>>().Get(name) ?? new();
            return (TClient)ActivatorUtilities.CreateInstance(serviceProvider, typeof(TClient), Options.Options.Create(options));
        });

        return serviceCollection;
    }
}
