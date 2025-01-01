using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing;


public record MyAggregate(Guid Id, string Name) : EventSourcedAggregate<Guid>(Id);

public delegate IEnumerable<MyAggregateDomainEvent> MyAggregateDecide<TCommand>(
    MyAggregate aggregate,
    TCommand command
) where TCommand : EventSourcedCommand<Guid>;


public record CreateAggregate(Guid AggregateId, string Name) : EventSourcedCommand<Guid>(AggregateId);
public record UpdateAggregateName(Guid AggregateId, string Name) : EventSourcedCommand<Guid>(AggregateId);


public record MyAggregateDomainEvent(Guid AggregateId) : EventSourcedEvent<Guid>(AggregateId);
public record AggregateCreated(Guid AggregateId, string Name) : MyAggregateDomainEvent(AggregateId);
public record AggregateNameUpdated(Guid AggregateId, string Name) : MyAggregateDomainEvent(AggregateId);

public interface IMyPolicy
{

}

[Decider]
public static class MyAggregateDecider
{
    public static MyAggregateDecide<CreateAggregate> CreateAggregate(IMyPolicy policy) => (aggregate, command) =>
    {
        return [new AggregateCreated(command.AggregateId, command.Name)];
    };
    public static MyAggregateDecide<UpdateAggregateName> UpdateAggregateName() => (aggregate, command) =>
    {
        return [new AggregateNameUpdated(command.AggregateId, command.Name)];
    };
}

