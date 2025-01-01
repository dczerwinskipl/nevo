namespace NEvo.Ddd.EventSourcing.Evolving
{
    public interface IEvolver<TAggregate, TKey, TEvent>
        where TAggregate : EventSourcedAggregate<TKey>
        where TEvent : EventSourcedEvent<TKey>
    {
        TAggregate Evolve(TAggregate aggregate, TEvent @event);
    }
}