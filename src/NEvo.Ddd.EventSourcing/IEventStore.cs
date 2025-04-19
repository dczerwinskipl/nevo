namespace NEvo.Ddd.EventSourcing;

public interface IEventStore
{
    public EitherAsync<Exception, Unit> AppendEventsAsync<TEvent, TAggregate, TId>(TId streamId, IEnumerable<TEvent> events, CancellationToken cancellationToken)
        where TEvent : IAggregateEvent<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;

    public OptionAsync<TAggregate> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;

    public OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId>
        where TId : notnull;
}
