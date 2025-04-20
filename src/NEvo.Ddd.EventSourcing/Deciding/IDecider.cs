namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IDecider
{
    public EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(TAggregate aggregate, IAggregateCommand<TAggregate, TId> command, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;
}