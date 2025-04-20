namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IDeciderRegistry
{
    public Option<IDecider> GetDecider<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;
}
