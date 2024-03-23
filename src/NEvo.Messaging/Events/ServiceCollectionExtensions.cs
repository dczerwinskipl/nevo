using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Publish;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddEvents(this IServiceCollection services, bool useInternalEventProcessing = false /* TODO: extend by eventType*/)
    {
        services.AddSingleton<IMessageHandlerFactory, EventHandlerAdapterFactory>();
        services.AddScoped<IMessageProcessingStrategy, EventProcessingStrategy>();
        services.AddScoped<IEventPublisher, EventPublisher>();
        services.AddScoped<IMessagePublishStrategyFactory<Event>, DefaultEventPublishStrategyFactory>();

        return services;
    }
}
