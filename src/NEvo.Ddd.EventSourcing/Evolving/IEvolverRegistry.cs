namespace NEvo.Ddd.EventSourcing.Evolving;

public interface IEvolverRegistry
{
    public Option<IEvolver> GetEvolver<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}
