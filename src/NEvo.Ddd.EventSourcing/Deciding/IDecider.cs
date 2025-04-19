namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IDecider
{
    public EitherAsync<Exception, IEnumerable<TEvent>> DecideAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, TAggregate aggregate, CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull;
}