namespace NEvo.Ddd.EventSourcing.Evolving;

public interface IEvolver
{
    public Either<Exception, TAggregate> Evolve<TAggregate, TId>(TAggregate aggregate, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;
}
