using LanguageExt;

namespace NEvo.Ddd.EventSourcing;

public interface IDecider
{
    public EitherAsync<Exception, TEvent[]> DecideAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, TAggregate aggregate, CancellationToken cancellationToken)
        where TCommand : AggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : AggregateEvent<TAggregate, TId>
        where TId : notnull;
}