using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection UseMessages(this IServiceCollection services)
    {
        // TODO: check scopes
        services.AddSingleton<IMessageHandlerExtractor, MessageHandlerExtractor>();
        services.AddSingleton<IMessageHandlerRegistry, MessageHandlerRegistry>();
        services.AddSingleton<IMessageProcessingStrategyFactory, MessageProcessingStrategyFactory>();
        services.AddSingleton<IMessageProcessor, MessageProcessor>();

        return services;
    }

    public static IServiceCollection UseMessageProcessingMiddleware<TMiddleware>(this IServiceCollection services) where TMiddleware : class, IMessageProcessingMiddleware
    {
        // TODO: different scopes?
        services.AddSingleton<TMiddleware>();
        services.AddSingleton(sp => new MessageProcessingMiddlewareConfig(sp.GetRequiredService<TMiddleware>()));

        return services;
    }
}
