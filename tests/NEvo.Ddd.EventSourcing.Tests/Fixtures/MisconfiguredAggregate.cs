using LanguageExt;
using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// A deliberately misconfigured aggregate: its decision method's declared event type
// implements IAggregateEvent<,> but does not derive from Event — used only to prove
// AggregateDeciderExtractor rejects this at discovery time instead of silently
// producing an aggregate with no usable decider.
public class MisconfiguredAggregate(Guid id) : IAggregateRoot<Guid>
{
    public Guid Id { get; set; } = id;

    public static Either<Exception, IEnumerable<NonEventDeciderOutput>> Create(CreateMisconfiguredAggregate command)
        => new[] { new NonEventDeciderOutput(command.MisconfiguredAggregateId) };
}

public record MisconfiguredAggregateCommand(Guid MisconfiguredAggregateId) : Command, IAggregateCommand<MisconfiguredAggregate, Guid>
{
    public Guid StreamId => MisconfiguredAggregateId;
}

public record CreateMisconfiguredAggregate(Guid MisconfiguredAggregateId) : MisconfiguredAggregateCommand(MisconfiguredAggregateId);

public record NonEventDeciderOutput(Guid StreamId) : IAggregateEvent<MisconfiguredAggregate, Guid>;
