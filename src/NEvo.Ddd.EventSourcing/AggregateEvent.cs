using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing;

public record AggregateEvent<TAggregate, TId> : Event where TAggregate : IAggregateRoot<TId, TAggregate> where TId : notnull
{
    public required TId StreamId { get; init; }

    public AggregateEvent(TId streamId) : base() { StreamId = streamId; }
    public AggregateEvent(TId streamId, Guid id, DateTime createdAt) : base(id, createdAt) { StreamId = streamId; }
}
