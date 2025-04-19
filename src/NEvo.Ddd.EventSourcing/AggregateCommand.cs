using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.Ddd.EventSourcing;

public record AggregateCommand<TAggregate, TId> : Command where TAggregate : IAggregateRoot<TId, TAggregate> where TId : notnull
{
    public required TId StreamId { get; init; }

    public AggregateCommand(TId streamId) : base() { StreamId = streamId; }
    public AggregateCommand(TId streamId, Guid id, DateTime createdAt) : base(id, createdAt) { StreamId = streamId; }
}

public interface ICreateAggregateCommand;