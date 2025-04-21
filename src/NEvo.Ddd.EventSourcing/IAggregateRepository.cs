namespace NEvo.Ddd.EventSourcing;

public interface IAggregateRepository
{
    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, int expectedVersion, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public OptionAsync<(TAggregate Aggregate, int Version)> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId>
        where TId : notnull;
}
