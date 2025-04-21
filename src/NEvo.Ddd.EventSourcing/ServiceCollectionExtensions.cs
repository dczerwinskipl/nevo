using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Ddd.EventSourcing;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Handling;

namespace Microsoft.Extensions.DependencyInjection;

public class FakeEventStore : IEventStore
{
    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        return Unit.Default;
    }

    public OptionAsync<TAggregate> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        return OptionAsync<TAggregate>.None;
    }

    public OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId>
        where TId : notnull
    {
        return OptionAsync<TProjection>.None;
    }
}

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddEventSourcing(this IServiceCollection services, params Type[] aggregateTypes)
    {
        services.TryAddScoped<IEventStore, FakeEventStore>();

        // deciders
        services.AddSingleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>();
        services.TryAddSingleton<IDeciderRegistry, DeciderRegistry>();
        {
            // aggregate decider dependencies
            services.Configure<AggregateExtractorConfiguration>(options =>
            {
                options.AggregateTypes.UnionWith(aggregateTypes);
            });
            services.AddSingleton<IDecider, AggregateDecider>();
            services.AddSingleton<IAggregateDeciderProvider, AggregateDeciderProvider>();
        }
        // evolvers?

        return services;
    }
}
