namespace NEvo.Ddd.EventSourcing;

public interface IEventSourcedAggregateRepository<TAggregate, TKey, TEvent>
    where TAggregate : EventSourcedAggregate<TKey>
    where TEvent : EventSourcedEvent<TKey>
{
    public Task<IEnumerable<TEvent>> GetEventsAsync(TKey aggregateId);
    public Task<TAggregate> GetAggregateAsync(TKey aggregateId);
    public Task AppendEvents(TKey aggregateId, IEnumerable<TEvent> events);
}
