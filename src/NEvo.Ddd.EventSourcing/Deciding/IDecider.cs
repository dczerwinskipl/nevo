namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IDecider
{
    public IEnumerable<DeciderDescription> GetDeciderDescriptions();

    public bool CanHandle<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(Option<TAggregate> aggregate, IAggregateCommand<TAggregate, TId> command, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}