namespace NEvo.Ddd.EventSourcing.Evolving;

public interface IEvolverRepository
{
    public Option<IEvolver> GetEvolver<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}
