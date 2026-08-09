using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Messaging.Cqrs.Queries;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddQueries(this IServiceCollection services)
    {
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerFactory, QueryHandlerAdapterFactory>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IMessageProcessingStrategyWithResult, QueryProcessingStrategy>());
        services.TryAddScoped<IQueryDispatcher, QueryDispatcher>();

        return services;
    }
}
