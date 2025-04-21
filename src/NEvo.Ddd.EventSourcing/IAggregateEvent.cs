namespace NEvo.Ddd.EventSourcing;

public interface IAggregateEvent<TAggregate, TId> where TAggregate : IAggregateRoot<TId> where TId : notnull
{
    public TId StreamId { get; }
}
