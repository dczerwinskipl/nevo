namespace NEvo.Ddd.EventSourcing;

public abstract record EventSourcedEvent<T>(T AggregateId) : Event;
