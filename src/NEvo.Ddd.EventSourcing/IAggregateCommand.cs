using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.Ddd.EventSourcing;

public interface IAggregateCommand<TAggregate, TId> where TAggregate : IAggregateRoot<TId, TAggregate> where TId : notnull
{
    public TId StreamId { get; }
}
