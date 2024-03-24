using NEvo.Messaging.Context;
using NEvo.Messaging.Dispatch;
using NEvo.Messaging.Dispatch.Internal;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;
using NEvo.Messaging.Handling.Strategies;
using NEvo.Messaging.Publish;
using NEvo.Messaging.Publishing.Internal;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddMessages(this IServiceCollection services)
    {
        // TODO: check scopes
        services.AddSingleton<IMessageHandlerExtractor, MessageHandlerExtractor>();
        services.AddSingleton<IMessageHandlerRegistry, MessageHandlerRegistry>();

        services.AddMessageProcessingMiddleware<CorrelationIdMessageProcessingMiddleware>();
        services.AddMessageProcessingMiddleware<CausationIdMessageProcessingMiddleware>();

        services.AddScoped<IMessageProcessingStrategyFactory, MessageProcessingStrategyFactory>();
        services.AddScoped<IMessageProcessor, MessageProcessor>();

        services.AddScoped<IMessageContextProvider, MessageContextProvider>();

        services.AddScoped<IMessageDispatchStrategy, InternalSyncProcessDispatchStrategy>();
        services.AddScoped<IInternalMessageDispatchStrategy, InternalSyncProcessDispatchStrategy>();

        services.AddScoped<IMessagePublishStrategy, InternalSyncProcessPublishStrategy>();
        services.AddScoped<IInternalMessagePublishStrategy, InternalSyncProcessPublishStrategy>();

        return services;
    }

    public static IServiceCollection AddMessageProcessingMiddleware<TMiddleware>(this IServiceCollection services) where TMiddleware : class, IMessageProcessingMiddleware
    {
        // TODO: different scopes?
        services.AddScoped<TMiddleware>();
        services.AddScoped(sp => new MessageProcessingMiddlewareConfig(sp.GetRequiredService<TMiddleware>()));

        return services;
    }
}
