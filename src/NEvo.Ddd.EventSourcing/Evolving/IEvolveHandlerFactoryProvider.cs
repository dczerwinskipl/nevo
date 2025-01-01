namespace NEvo.Ddd.EventSourcing.Evolving;

public interface IEvolveHandlerFactoryProvider<TAggregate, TKey, TEvent>
{
    Func<TAggregate, TEvent, TAggregate> GetHandlerFactory(Type eventType);
}
