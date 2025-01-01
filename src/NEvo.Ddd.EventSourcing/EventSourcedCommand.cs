namespace NEvo.Ddd.EventSourcing;

public abstract record EventSourcedCommand<T>(T AggregateId) : Command;
