using NEvo.Ddd.EventSourcing;
using NEvo.Ddd.EventSourcing.Deciding;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddDecider<TAggregate, TKey, TCommand, TEvent>(this IServiceCollection services, Type deciderContainer)
        where TAggregate : EventSourcedAggregate<TKey>
        where TCommand : EventSourcedCommand<TKey>
        where TEvent : EventSourcedEvent<TKey>
    {
        services.AddSingleton<IDecideHandlerFactoryProvider<TAggregate, TKey, TCommand, TEvent>, DecideHandlerProvider<TAggregate, TKey, TCommand, TEvent>>(sp => new(deciderContainer));
        services.AddSingleton<IDecider<TAggregate, TKey, TCommand, TEvent>, Decider<TAggregate, TKey, TCommand, TEvent>>();
        return services;
    }
}
