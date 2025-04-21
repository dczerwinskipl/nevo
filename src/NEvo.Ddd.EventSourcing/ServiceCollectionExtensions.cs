using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Ddd.EventSourcing;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Handling;

namespace Microsoft.Extensions.DependencyInjection;

public class FakeEventStore : IEventStore
{
    private readonly ConcurrentDictionary<object, List<dynamic>> _store = new();

    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, int expectedVersion, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var stream = _store.GetOrAdd(streamId, _ => []);
        if (expectedVersion != stream.Count)
        {
            return new Exception($"Expected version {expectedVersion} but found {stream.Count}");
        }
        stream.AddRange(events);
        return Unit.Default;
    }

    public EitherAsync<Exception, (IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)> LoadEventsStreamAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var stream = _store.GetOrAdd(streamId, _ => []);
        return (stream.Cast<IAggregateEvent<TAggregate, TId>>(), stream.Count);
    }
}

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddEventSourcing(this IServiceCollection services, params Type[] aggregateTypes)
    {
        services.TryAddSingleton<IEventStore, FakeEventStore>();
        services.TryAddScoped<IAggregateRepository, AggregateRepository>();
        services.AddSingleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>();
        services.TryAddSingleton<IEvolverRegistry, EvolverRegistry>();
        services.TryAddSingleton<IDeciderRegistry, DeciderRegistry>();

        // aggregate based deciders/evolvers
        {
            services.Configure<AggregateExtractorConfiguration>(options =>
            {
                options.AggregateTypes.UnionWith(aggregateTypes);
            });

            services.AddSingleton<IDecider, AggregateDecider>();
            services.AddSingleton<IAggregateDeciderProvider, AggregateDeciderProvider>();
            // TODO: add provider?
            services.AddSingleton<IEvolver, AggregateEvolver>();
        }

        return services;
    }
}
