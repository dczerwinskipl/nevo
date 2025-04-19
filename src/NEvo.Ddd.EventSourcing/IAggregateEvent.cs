using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing;

public interface IAggregateEvent<TAggregate, TId> where TAggregate : IAggregateRoot<TId, TAggregate> where TId : notnull
{
    public TId StreamId { get; }
}
