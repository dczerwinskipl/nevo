using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing;

/// <summary>
/// Obtains an aggregate's event stream, rehydrates it, and returns the current state
/// and its observed version. Composes an <see cref="IEventStreamStore"/> with an
/// evolver rather than reading raw events itself.
/// </summary>
public interface IAggregateRepository
{
    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, ExpectedStreamState expectedState, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public EitherAsync<Exception, Option<(TAggregate Aggregate, int Version)>> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}

/// <summary>
/// Reads and appends raw event streams. Does not rehydrate aggregates and does not
/// load projections — that is <see cref="IAggregateRepository"/>'s responsibility.
/// </summary>
public interface IEventStreamStore
{
    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, ExpectedStreamState expectedState, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    /// <summary>
    /// <c>None</c> means the stream does not exist; <c>Some</c> contains its events and
    /// observed version — the two are never collapsed into the same shape.
    /// </summary>
    public EitherAsync<Exception, Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>> LoadEventsStreamAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}

public class AggregateRepository(IEventStreamStore eventStore, IEvolverRegistry evolverRepository) : IAggregateRepository
{
    private readonly IEventStreamStore _eventStore = eventStore;
    private readonly IEvolverRegistry _evolverRepository = evolverRepository;

    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, ExpectedStreamState expectedState, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => _eventStore.AppendEventsAsync(streamId, events, expectedState, cancellationToken);

    public EitherAsync<Exception, Option<(TAggregate Aggregate, int Version)>> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => from streamOption in _eventStore.LoadEventsStreamAsync<TAggregate, TId>(streamId, cancellationToken)
           from evolver in _evolverRepository
               .GetEvolver<TAggregate, TId>()
               .ToEitherAsync(() => new Exception($"No evolver found for aggregate {typeof(TAggregate).Name}"))
           from aggregateOption in EvolveStream(streamOption, evolver).ToAsync()
           select aggregateOption;

    private Either<Exception, Option<(TAggregate, int)>> EvolveStream<TAggregate, TId>(
        Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)> streamOption,
        IEvolver evolver)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        foreach (var stream in streamOption)
        {
            return ApplyEvents(stream.Events, evolver)
                .Map(aggregateOption => aggregateOption.Map(agg => (agg, stream.Version)));
        }

        return Option<(TAggregate, int)>.None;
    }

    public Either<Exception, Option<TAggregate>> ApplyEvents<TAggregate, TId>(IEnumerable<IAggregateEvent<TAggregate, TId>> events, IEvolver evolver)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        if (!events.Any())
        {
            return Option<TAggregate>.None;
        }

        var aggregate = evolver.Evolve(Option<TAggregate>.None, events.First());
        foreach (var @event in events.Skip(1))
        {
            aggregate = aggregate.Bind(agg => evolver.Evolve(agg, @event));
        }

        return aggregate.Bind<Option<TAggregate>>(agg => Option<TAggregate>.Some(agg));
    }
}
