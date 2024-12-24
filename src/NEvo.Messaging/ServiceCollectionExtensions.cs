using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Messaging.Context;
using NEvo.Messaging.Dispatching;
using NEvo.Messaging.Dispatching.Internal;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;
using NEvo.Messaging.Handling.Strategies;
using NEvo.Messaging.Publish;
using NEvo.Messaging.Publishing.Internal;
using NEvo.Messaging.Transporting;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddMessages(this IServiceCollection services)
    {
        // TODO: check scopes
        services.TryAddSingleton<IMessageHandlerExtractor, MessageHandlerExtractor>();
        services.TryAddSingleton<IMessageHandlerRegistry, MessageHandlerRegistry>();
        services.TryAddSingleton<IMessageContextAccessor, MessageContextAccessor>();

        // default middlesares
        services.AddMessageProcessingMiddleware<CorrelationIdMessageProcessingMiddleware>();
        services.AddMessageProcessingMiddleware<CausationIdMessageProcessingMiddleware>();
        // TOOD: optional?
        services.AddMessageProcessingMiddleware<TelemetryMessageProcessingMiddleware>();
        services.AddMessageProcessingHandlerMiddleware<TelemetryMessageProcessingMiddleware>();

        // processing
        services.AddScoped<IMessageProcessingStrategyFactory, MessageProcessingStrategyFactory>();
        services.AddScoped<IMessageProcessor, MessageProcessor>();
        services.AddScoped<IMessageContextProvider, MessageContextProvider>();

        // dispatch
        services.AddScoped<IMessageDispatchStrategy, InternalSyncProcessDispatchStrategy>();
        services.AddScoped<IInternalMessageDispatchStrategy, InternalSyncProcessDispatchStrategy>();

        // publish
        services.AddScoped<IMessagePublishStrategy, InternalSyncProcessPublishStrategy>();
        services.AddScoped<IInternalMessagePublishStrategy, InternalSyncProcessPublishStrategy>();

        // transport
        services.AddSingleton<IMessageEnvelopeMapper, MessageEnvelopeMapper>();
        services.AddSingleton<IMessageSerializer, DefaultMessageSerializer>();
        services.AddSingleton<IMessageTypeMapper, DefaultMessageTypeMapper>();

        return services;
    }

    public static IServiceCollection AddMessageProcessingMiddleware<TMiddleware>(this IServiceCollection services) where TMiddleware : class, IMessageProcessingMiddleware
    {
        // TODO: different scopes?
        services.TryAddScoped<TMiddleware>();
        services.AddScoped(sp => new MessageProcessingMiddlewareConfig(sp.GetRequiredService<TMiddleware>()));

        return services;
    }
    public static IServiceCollection AddMessageProcessingHandlerMiddleware<TMiddleware>(this IServiceCollection services) where TMiddleware : class, IMessageProcessingHandlerMiddleware
    {
        // TODO: different scopes?
        services.TryAddScoped<TMiddleware>();
        services.AddScoped(sp => new MessageProcessingHandlerMiddlewareConfig(sp.GetRequiredService<TMiddleware>()));

        return services;
    }
}
