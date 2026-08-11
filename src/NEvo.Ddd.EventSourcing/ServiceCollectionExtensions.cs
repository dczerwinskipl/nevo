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
    // Keyed by (aggregate type, stream id) — streamId alone would let two different
    // aggregate types with the same id value (e.g. Document(Guid X) and Order(Guid X))
    // collide into a single stream, silently mixing incompatible event types and
    // corrupting both. IEventStreamStore's own contract is already generic per
    // TAggregate; this key just stops discarding that distinction.
    //
    // A single gate guards every read/append: the version check + mutation must be one
    // atomic unit (TryGetValue -> compare -> mutate is not safe under
    // ConcurrentDictionary alone — two concurrent appends can both observe the same
    // pre-mutation version and both pass the check), and List<dynamic> itself is not
    // thread-safe for concurrent mutation.
    private readonly object _gate = new();
    private readonly Dictionary<(Type AggregateType, object StreamId), List<dynamic>> _store = [];

    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, ExpectedStreamState expectedState, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var key = (typeof(TAggregate), (object)streamId);
        lock (_gate)
        {
            var exists = _store.TryGetValue(key, out var existingStream);
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

            if (!exists)
            {
                existingStream = [];
                _store[key] = existingStream;
            }

            existingStream!.AddRange(events);
            return Unit.Default;
        }
    }

    public EitherAsync<Exception, Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>> LoadEventsStreamAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var key = (typeof(TAggregate), (object)streamId);
        lock (_gate)
        {
            if (!_store.TryGetValue(key, out var stream))
            {
                return Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>.None;
            }

            // Snapshot under the lock so a concurrent append after this point doesn't
            // mutate the list the caller is about to read.
            var snapshot = stream.ToList();
            return Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>.Some(
                (snapshot.Cast<IAggregateEvent<TAggregate, TId>>(), snapshot.Count)
            );
        }
    }
}

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddEventSourcing(this IServiceCollection services, params Type[] aggregateTypes)
    {
        services.TryAddSingleton<IEventStreamStore, FakeEventStore>();
        services.TryAddScoped<IAggregateRepository, AggregateRepository>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>());
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerFactory, EventSourcedCommandHandlerAdapterFactory>());
        services.TryAddSingleton<IEvolverRegistry, EvolverRegistry>();
        services.TryAddSingleton<IDeciderRegistry, DeciderRegistry>();
        services.TryAddScoped<IEventSourcedCommandExecutor, EventSourcedCommandExecutor>();
        services.TryAddTransient(typeof(IAggregateAuthorization<,,>), typeof(AllowAllAggregateAuthorization<,,>));

        // aggregate based deciders/evolvers
        {
            services.Configure<AggregateExtractorConfiguration>(options =>
            {
                options.AggregateTypes.UnionWith(aggregateTypes);
            });

            // Registered both as itself (so a Level 2 handler can inject the concrete
            // aggregate-method convention unambiguously, per IEventSourcedCommandHandler's
            // own doc) and as IDecider (so DeciderRegistry's IEnumerable<IDecider>
            // collection sees it as one of possibly several decision mechanisms) — two
            // independent singleton instances, since the DI container does not share an
            // instance across two differently-typed registrations of the same
            // implementation type; both do identical, cheap, deterministic setup work.
            services.TryAddSingleton<AggregateDecider>();
            services.TryAddEnumerable(ServiceDescriptor.Singleton<IDecider, AggregateDecider>());
            services.TryAddSingleton<IAggregateDeciderProvider, AggregateDeciderProvider>();
            services.TryAddEnumerable(ServiceDescriptor.Singleton<IEvolver, AggregateEvolver>());
        }

        return services;
    }
}
