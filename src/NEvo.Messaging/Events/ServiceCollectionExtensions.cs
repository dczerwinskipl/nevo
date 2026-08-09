using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;
using NEvo.Messaging.Publishing;
using System.Diagnostics.CodeAnalysis;

namespace Microsoft.Extensions.DependencyInjection;

[ExcludeFromCodeCoverage]
public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddEvents(this IServiceCollection services)
    {
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerFactory, EventHandlerAdapterFactory>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IMessageProcessingStrategy, ParallelEventProcessingStrategy>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IMessageProcessingStrategy, SequentialEventProcessingStrategy>());
        services.TryAddScoped<IEventPublisher, EventPublisher>();
        services.TryAddScoped<IMessagePublishStrategyFactory<Event>, DefaultEventPublishStrategyFactory>();

        return services;
    }
}
