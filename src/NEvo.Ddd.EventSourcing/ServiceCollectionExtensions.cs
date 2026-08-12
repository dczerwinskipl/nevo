using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Ddd.EventSourcing;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Context;
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
    /// <summary>
    /// Registers Event Sourcing with the aggregate-method convention fallback enabled
    /// (the default). Delegates to the additive
    /// <see cref="AddEventSourcing(IServiceCollection, Action{EventSourcingOptions}, Type[])"/>
    /// overload with default options — existing call sites keep compiling and behaving
    /// unchanged.
    /// </summary>
    public static IServiceCollection AddEventSourcing(this IServiceCollection services, params Type[] aggregateTypes)
        => services.AddEventSourcing(static _ => { }, aggregateTypes);

    public static IServiceCollection AddEventSourcing(this IServiceCollection services, Action<EventSourcingOptions> configure, params Type[] aggregateTypes)
    {
        var options = new EventSourcingOptions();
        configure(options);

        // AggregateDecider's parameter-injection resolver reads the current invocation's
        // scope through this accessor (already NEvo.Messaging infrastructure, no new
        // project reference) — TryAdd so a consumer that separately calls
        // NEvo.Messaging's own AddMessaging() first is unaffected (D4/D32 idempotency
        // convention).
        services.TryAddSingleton<IMessageContextAccessor, MessageContextAccessor>();
        services.TryAddSingleton<IEventStreamStore, FakeEventStore>();
        services.TryAddScoped<IAggregateRepository, AggregateRepository>();
        // The convention fallback route is what makes MessageHandlerRegistry
        // auto-route a command to the aggregate-method convention — this is the one
        // thing the toggle controls. The decider/evolver machinery below stays
        // registered regardless, since an explicit Event Sourced handler may still
        // delegate to IAggregateMethodDecider even with the fallback route disabled.
        if (options.UseAggregateMethodFallback)
        {
            services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>());
        }
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerFactory, EventSourcedCommandHandlerAdapterFactory>());
        services.TryAddSingleton<IEvolverRegistry, EvolverRegistry>();
        services.TryAddSingleton<IDeciderRegistry, DeciderRegistry>();
        services.TryAddScoped<IEventSourcedCommandExecutor, EventSourcedCommandExecutor>();
        services.TryAddTransient(typeof(IAggregateAuthorization<,,>), typeof(AllowAllAggregateAuthorization<,,>));

        // aggregate based deciders/evolvers
        {
            services.Configure<AggregateExtractorConfiguration>(opts =>
            {
                opts.AggregateTypes.UnionWith(aggregateTypes);
            });

            // AggregateDecider is the current implementation of two distinct public
            // roles: IAggregateMethodDecider (the stable capability an explicit Event
            // Sourced handler delegates to) and IDecider (one of possibly several
            // decision mechanisms DeciderRegistry's IEnumerable<IDecider> collection
            // sees). Each is its own singleton — a small, cheap, deterministic object —
            // rather than one instance shared via a factory alias, so the concrete
            // AggregateDecider type is never itself resolvable as a dependency.
            services.TryAddSingleton<IAggregateMethodDecider, AggregateDecider>();
            services.TryAddEnumerable(ServiceDescriptor.Singleton<IDecider, AggregateDecider>());
            services.TryAddSingleton<IAggregateDeciderProvider, AggregateDeciderProvider>();
            services.TryAddEnumerable(ServiceDescriptor.Singleton<IEvolver, AggregateEvolver>());
        }

        return services;
    }
}
