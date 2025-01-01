namespace NEvo.Ddd.EventSourcing.Evolving;

public class Evolver<TAggregate, TKey, TEvent>(
    EvolveHandlerProvider<TAggregate, TKey, TEvent> handlerProvider
) : IEvolver<TAggregate, TKey, TEvent> where TAggregate : EventSourcedAggregate<TKey>
    where TEvent : EventSourcedEvent<TKey>
{
    private readonly EvolveHandlerProvider<TAggregate, TKey, TEvent> _handlerProvider = handlerProvider;

    public TAggregate Evolve(TAggregate aggregate, TEvent @event)
    {
        var handler = _handlerProvider.GetHandlerFactory(@event.GetType());
        return handler(aggregate, @event);
    }
}
