using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Ddd.EventSourcing;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Handling;

namespace Microsoft.Extensions.DependencyInjection;

public class FakeEventStore : IEventStreamStore
{
    private readonly ConcurrentDictionary<object, List<dynamic>> _store = new();

    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, ExpectedStreamState expectedState, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var exists = _store.TryGetValue(streamId, out var existingStream);
        var currentVersion = exists ? existingStream!.Count : 0;

        var mismatch = expectedState switch
        {
            ExpectedStreamState.NoStreamState => exists,
            ExpectedStreamState.ExactState exact => !exists || exact.Version != currentVersion,
            _ => throw new NotSupportedException($"Unsupported expected stream state '{expectedState.GetType().Name}'.")
        };

        if (mismatch)
        {
            return new AggregateConcurrencyException(streamId.ToString() ?? streamId.GetType().Name, expectedState, currentVersion);
        }

        var stream = _store.GetOrAdd(streamId, _ => []);
        stream.AddRange(events);
        return Unit.Default;
    }

    public EitherAsync<Exception, Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>> LoadEventsStreamAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        if (!_store.TryGetValue(streamId, out var stream))
        {
            return Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>.None;
        }

        return Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>.Some(
            (stream.Cast<IAggregateEvent<TAggregate, TId>>(), stream.Count)
        );
    }
}

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddEventSourcing(this IServiceCollection services, params Type[] aggregateTypes)
    {
        services.TryAddSingleton<IEventStreamStore, FakeEventStore>();
        services.TryAddScoped<IAggregateRepository, AggregateRepository>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>());
        services.TryAddSingleton<IEvolverRegistry, EvolverRegistry>();
        services.TryAddSingleton<IDeciderRegistry, DeciderRegistry>();
        services.TryAddScoped<IEventSourcedCommandExecutor, EventSourcedCommandExecutor>();
        services.TryAddTransient(typeof(IAggregateAuthorization<,,>), typeof(NoOpAggregateAuthorization<,,>));

        // aggregate based deciders/evolvers
        {
            services.Configure<AggregateExtractorConfiguration>(options =>
            {
                options.AggregateTypes.UnionWith(aggregateTypes);
            });

            services.TryAddEnumerable(ServiceDescriptor.Singleton<IDecider, AggregateDecider>());
            services.TryAddSingleton<IAggregateDeciderProvider, AggregateDeciderProvider>();
            // TODO: add provider?
            services.TryAddEnumerable(ServiceDescriptor.Singleton<IEvolver, AggregateEvolver>());
        }

        return services;
    }
}
