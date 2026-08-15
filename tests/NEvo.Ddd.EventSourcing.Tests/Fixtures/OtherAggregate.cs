using LanguageExt;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// A second, unrelated aggregate type — used only to prove FakeEventStore does not
// collide two different aggregate types that happen to share the same stream id value.
public class OtherAggregate(Guid id) : IAggregateRoot<Guid>
{
    public Guid Id { get; set; } = id;

    public static Either<Exception, IEnumerable<OtherAggregateEvent>> Create(CreateOtherAggregate command)
        => new[] { new OtherAggregateCreated(command.OtherAggregateId) };
}

public record OtherAggregateCommand(Guid OtherAggregateId) : Command, IAggregateCommand<OtherAggregate, Guid>
{
    public Guid StreamId => OtherAggregateId;
}

public record CreateOtherAggregate(Guid OtherAggregateId) : OtherAggregateCommand(OtherAggregateId);

public abstract record OtherAggregateEvent(Guid OtherAggregateId) : Event, IAggregateEvent<OtherAggregate, Guid>
{
    public Guid StreamId => OtherAggregateId;
}

public record OtherAggregateCreated(Guid OtherAggregateId) : OtherAggregateEvent(OtherAggregateId);
