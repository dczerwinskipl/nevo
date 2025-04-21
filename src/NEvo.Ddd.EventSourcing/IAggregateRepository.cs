using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing;

public interface IAggregateRepository
{
    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, int expectedVersion, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public EitherAsync<Exception, Option<(TAggregate Aggregate, int Version)>> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId>
        where TId : notnull;
}

public interface IEventStore
{
    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, int expectedVersion, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public EitherAsync<Exception, (IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)> LoadEventsStreamAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}

public class AggregateRepository(IEventStore eventStore, IEvolverRepository evolverRepository) : IAggregateRepository
{
    private readonly IEventStore _eventStore = eventStore;
    private readonly IEvolverRepository _evolverRepository = evolverRepository;

    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, int expectedVersion, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => _eventStore.AppendEventsAsync(streamId, events, expectedVersion, cancellationToken);

    public EitherAsync<Exception, Option<(TAggregate Aggregate, int Version)>> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => from eventsResult in _eventStore.LoadEventsStreamAsync<TAggregate, TId>(streamId, cancellationToken)
           from evolver in _evolverRepository
               .GetEvolver<TAggregate, TId>()
               .ToEitherAsync(() => new Exception($"No evolver found for aggregate {typeof(TAggregate).Name}"))
           let events = eventsResult.Events
           let version = eventsResult.Version
           from aggregate in ApplyEvents(events, evolver).ToAsync()
           select aggregate.Map(agg => (agg, version));

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


    public OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId>
        where TId : notnull
        => throw new NotImplementedException();
}