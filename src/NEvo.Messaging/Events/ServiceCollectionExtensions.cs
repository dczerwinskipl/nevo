using NEvo.Messaging;
using NEvo.Messaging.Cqrs.Events;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection UseEvents(this IServiceCollection services, bool useInternalEventProcessing = false /* TODO: extend by eventType*/)
    {
        services.AddSingleton<IMessageHandlerFactory, EventHandlerAdapterFactory>();
        services.AddSingleton<IMessageProcessingStrategy, EventProcessingStrategy>();
        services.AddSingleton<IEventPublisher, EventPublisher>();
        services.AddSingleton<IMessagePublishStrategyFactory<Event>, DefaultEventPublishStrategyFactory>();

        return services;
    }
}
