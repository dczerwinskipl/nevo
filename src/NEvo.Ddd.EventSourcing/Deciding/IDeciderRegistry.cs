namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IDeciderRegistry
{
    public Option<IDecider> GetDecider<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;

    public IEnumerable<DeciderDescription> GetCommands();
}

public record DeciderDescription
{
    public Type CommandType { get; init; }
    public Type AggregateType { get; init; }
    public Type IdType { get; init; }
    public Type DeciderType { get; init; }

    public override string ToString()
    {
        return $"{CommandType.Name} -> {AggregateType.Name} -> {IdType.Name} -> {DeciderType.Name}";
    }
}