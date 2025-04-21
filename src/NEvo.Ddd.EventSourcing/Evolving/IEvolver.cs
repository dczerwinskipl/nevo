namespace NEvo.Ddd.EventSourcing.Evolving;

public interface IEvolver
{
    public bool CanHandle<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    public Either<Exception, TAggregate> Evolve<TAggregate, TId>(Option<TAggregate> aggregate, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}
