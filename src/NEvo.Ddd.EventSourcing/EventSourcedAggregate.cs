namespace NEvo.Ddd.EventSourcing;

public abstract record EventSourcedAggregate<T>(T Id);
