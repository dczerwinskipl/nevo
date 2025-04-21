namespace NEvo.Ddd.EventSourcing;

public interface ICreateAggregateCommand<TAggregate, TId> : IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull;