using NEvo.Ddd.EventSourcing;
using NEvo.Ddd.EventSourcing.Evolving;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddEvolver<TAggregate, TKey, TEvent>(this IServiceCollection services, Type evolverContainer)
        where TAggregate : EventSourcedAggregate<TKey>
        where TEvent : EventSourcedEvent<TKey>
    {
        services.AddSingleton<IEvolveHandlerFactoryProvider<TAggregate, TKey, TEvent>, EvolveHandlerProvider<TAggregate, TKey, TEvent>>(sp => new(evolverContainer));
        services.AddSingleton<IEvolver<TAggregate, TKey, TEvent>, Evolver<TAggregate, TKey, TEvent>>();
        return services;
    }
}
